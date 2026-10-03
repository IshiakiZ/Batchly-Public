const sendResult = self.postMessage.bind(self);
// Disable child execution and network APIs before loading any submitted code.
// CSP is the network boundary even if a brain recovers the real Worker global.
for (const key of ['Worker', 'SharedWorker', 'importScripts', 'fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource']) {
  Object.defineProperty(self, key, { value: undefined, writable: false, configurable: false });
}
const load = createEngineLoader(ENGINE_SOURCES);
const modeInfo = {
  fighter: ['Fighter Duel', 'fighter.json', 'brain.js'],
  army: ['Army Battle', 'army.json', 'commander.js'],
  war: ['Modern Warfare', 'forces.json', 'commander.js'],
  business: ['Business Tycoon', 'company.json', 'strategy.js'],
};
const modes = Object.fromEntries(['army', 'war', 'business'].map(mode => [mode, load(`engine/modes/${mode}/index.js`)]));
const match = load('engine/match.js');
const loader = load('engine/loader.js');
function bundleOf(files, mode) {
  const [, design, brain] = modeInfo[mode];
  const lib = Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith('lib/')).map(([name, source]) => [name.slice(4), source]));
  if (mode !== 'fighter') return { design: files[design], brain: files[brain], lib, notes: files['notes.md'] || '' };
  return loader.bundleFromSnapshot({ fighter: JSON.parse(files[design]), brain: files[brain], lib, sprite: files['sprite.json'], notes: files['notes.md'] });
}
function filesOf(bundle, mode) {
  const [, design, brain] = modeInfo[mode];
  const files = { [design]: mode === 'fighter' ? JSON.stringify(bundle.json, null, 2) : bundle.design, [brain]: bundle.brain };
  for (const [name, text] of Object.entries(bundle.lib || {})) files[`lib/${name}`] = text;
  return files;
}
function runJob(job) {
  const { mode, round = 1 } = job;
  if (!modeInfo[mode] || !Number.isInteger(round) || round < 1 || round > 12) throw new Error('Invalid mode or round');
  if (job.action === 'catalog') {
    const botNames = mode === 'fighter' ? match.BOT_NAMES : modes[mode].bots;
    const starter = mode === 'fighter' ? filesOf(match.loadBot('rookie', 1), mode) : modes[mode].starter;
    return { mode, info: modeInfo[mode], starter, bots: botNames, level: mode === 'fighter' ? load('engine/rules.js').levelInfo(round) : modes[mode].levelInfo(round) };
  }
  if (job.action === 'bot') {
    const names = mode === 'fighter' ? match.BOT_NAMES : modes[mode].bots;
    if (!names.includes(job.bot)) throw new Error('Unknown built-in opponent');
    return { files: filesOf(mode === 'fighter' ? match.loadBot(job.bot, round) : modes[mode].botBundle(job.bot, round), mode) };
  }
  const bundles = job.builds.map(files => bundleOf(files, mode));
  const checks = bundles.map(bundle => mode === 'fighter'
    ? match.fullCheck(bundle, { level: round, mirror: round === 1 })
    : modes[mode].check(bundle, { level: round }));
  const problems = checks.map((check, side) => ({ side, ok: check.ok, errors: check.errors || [], warnings: check.warnings || [], text: check.text || '' }));
  if (job.action === 'check' || checks.some(check => !check.ok)) return { checks: problems, ok: checks.every(check => check.ok) };
  if (job.action !== 'fight') throw new Error('Unknown job');
  const options = { bundles, ids: ['claude', 'chatgpt'], labels: ['Claude', 'ChatGPT'], seed: 42, level: round, round, memories: job.memories || null };
  const outcome = mode === 'fighter'
    ? match.runFight({ ...options, theme: load('engine/themes.js').themeForRound(round, 1) })
    : modes[mode].simulate(options);
  const replay = outcome.replay;
  const stats = outcome.sim ? outcome.sim.stats : outcome.stats;
  const brainStats = outcome.sim ? outcome.sim.brainStats : outcome.brainErrors;
  return { ok: true, checks: problems, replay, memories: outcome.memories, result: { ...replay.result, stats, brainStats, unranked: true } };
}
self.onmessage = event => {
  try {
    const result = runJob(event.data);
    const text = JSON.stringify(result);
    if (text.length > 24 * 1024 * 1024) throw new Error('Replay exceeds browser output limit');
    sendResult({ ok: true, text });
  } catch (error) {
    sendResult({ ok: false, error: String(error.message || error).slice(0, 1000) });
  }
};
