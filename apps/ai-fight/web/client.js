import { runSimulation } from './runner.js';
import { hostRequest } from './host-bridge.js';
import { ArenaRenderer } from './js/renderer.js';
import { createView as armyView } from './js/modes/army/view.js';
import { createView as warView } from './js/modes/war/view.js';
import { createView as businessView } from './js/modes/business/view.js';
const $ = selector => document.querySelector(selector);
const cards = [...document.querySelectorAll('.build')];
const modeNames = { fighter: 'AI_GUIDE.md', army: 'ARMY_GUIDE.md', war: 'WAR_GUIDE.md', business: 'BUSINESS_GUIDE.md' };
const sessionId = new URL(location.href).searchParams.get('session');
const state = { mode: 'fighter', round: 1, builds: [{}, {}], memories: null, busy: false, replay: null, session: null };
let view = null, position = 0, playing = false, lastFrame = 0, controller, activeRevision = null;
const status = (text, error = false) => { $('#status').textContent = text; $('#status').classList.toggle('error', error); };
function save() {
  if (sessionId) return;
  try { localStorage.setItem('ai-fight-local-v1', JSON.stringify({ mode: state.mode, round: state.round, builds: state.builds, memories: state.memories })); } catch { $('#connection').textContent = 'Local match · export builds to keep them'; }
}
function busy(value) {
  state.busy = value;
  for (const id of ['fight', 'check', 'mode', 'next', 'reset']) $('#' + id).disabled = value || (!!sessionId && ['fight', 'check', 'mode', 'reset'].includes(id));
  $('#next').disabled = value || state.round >= 12 || !state.replay || (!!sessionId && state.session?.phase !== 'round_over');
  for (const card of cards) { card.querySelector('.editor').readOnly = value || !!sessionId; card.querySelector('.load-bot').disabled = value || !!sessionId; }
}
function syncEditors() {
  cards.forEach((card, side) => {
    const selector = card.querySelector('.file');
    const selected = selector.value;
    selector.replaceChildren(...Object.keys(state.builds[side]).map(name => new Option(name, name)));
    if (Object.hasOwn(state.builds[side], selected)) selector.value = selected;
    card.querySelector('.editor').value = state.builds[side][selector.value] || '';
  });
}
async function catalog(reset = false) {
  const result = await runSimulation({ action: 'catalog', mode: state.mode, round: state.round });
  if (reset) state.builds = [structuredClone(result.starter), structuredClone(result.starter)];
  $('#mode').value = state.mode;
  $('#round').textContent = state.round;
  for (const card of cards) card.querySelector('.bot').replaceChildren(...result.bots.map(name => new Option(name, name)));
  $('#report').textContent = JSON.stringify(result.level, null, 2);
  syncEditors();
}
function resize() {
  const canvas = $('#arena'), rect = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  view?.resize?.();
}
function showReplay(replay) {
  state.replay = replay;
  const canvas = $('#arena');
  view = state.mode === 'fighter' ? new ArenaRenderer(canvas) : { army: armyView, war: warView, business: businessView }[state.mode](canvas);
  resize();
  view.setReplay(replay, ['#e8825c', '#2fc58e']);
  $('#empty').hidden = true;
  position = 0; playing = true;
  $('#play').textContent = 'Pause';
  for (const id of ['play', 'seek', 'export-replay']) $('#' + id).disabled = false;
}
async function simulate(action) {
  if (state.busy) return;
  busy(true);
  controller = new AbortController();
  status(action === 'fight' ? 'Simulating the original engine in your browser...' : 'Checking both builds against the original rules...');
  try {
    const result = await runSimulation({ action, mode: state.mode, round: state.round, builds: state.builds, memories: state.memories }, { signal: controller.signal });
    if (!result.ok) {
      $('#report').textContent = JSON.stringify(result.checks, null, 2);
      if (sessionId) state.session = await hostRequest('complete', { session_id: sessionId, expected_revision: activeRevision, result: { validation_failed: true, checks: result.checks } });
      status('A build needs changes. Read the validation report below.', true);
      return;
    }
    if (action === 'check') { $('#report').textContent = JSON.stringify(result.checks, null, 2); status('Both builds passed the original rule checks.'); return; }
    showReplay(result.replay);
    state.memories = (result.memories || []).map(memory => typeof memory === 'object' && memory ? memory.json : memory);
    $('#report').textContent = JSON.stringify(result.result, null, 2);
    status(result.result.text || `Round ${state.round} finished. Watch the replay or evolve for the next round.`);
    if (sessionId) {
      state.session = await hostRequest('complete', { session_id: sessionId, expected_revision: activeRevision, result: result.result });
    }
    save();
  } catch (error) {
    if (sessionId && state.session?.phase === 'ready') {
      try { state.session = await hostRequest('complete', { session_id: sessionId, expected_revision: activeRevision, result: { validation_failed: true, error: String(error.message).slice(0,1000) } }); } catch { /* Keep the original simulation or transport error visible. */ }
    }
    status(error.message, true);
  }
  finally { controller = null; busy(false); }
}
async function reset(mode = state.mode) {
  controller?.abort();
  state.mode = mode; state.round = 1; state.memories = null; state.replay = null; view = null;
  $('#empty').hidden = false;
  busy(true);
  try { await catalog(true); status('Ready. Edit the starter brains or press Fight!'); save(); }
  catch (error) { status(error.message, true); }
  finally { busy(false); }
}
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
cards.forEach((card, side) => {
  card.querySelector('.file').addEventListener('change', () => { card.querySelector('.editor').value = state.builds[side][card.querySelector('.file').value] || ''; });
  card.querySelector('.editor').addEventListener('input', event => { state.builds[side][card.querySelector('.file').value] = event.target.value; save(); });
  card.querySelector('.load-bot').addEventListener('click', async () => {
    busy(true);
    try { const result = await runSimulation({ action: 'bot', mode: state.mode, round: state.round, bot: card.querySelector('.bot').value }); state.builds[side] = result.files; syncEditors(); save(); status('Built-in opponent loaded. Round 1 Fighter Duel requires the Rookie design.'); }
    catch (error) { status(error.message, true); } finally { busy(false); }
  });
});
$('#mode').addEventListener('change', event => reset(event.target.value));
$('#reset').addEventListener('click', () => reset());
$('#fight').addEventListener('click', () => simulate('fight'));
$('#check').addEventListener('click', () => simulate('check'));
$('#next').addEventListener('click', async () => {
  if (state.round >= 12 || state.busy) return;
  busy(true);
  try {
    if (sessionId) { state.session = await hostRequest('next', { session_id: sessionId, expected_revision: state.session.revision }); await applySession(state.session); }
    else { state.round++; state.replay = null; await catalog(); status('New level unlocked. Evolve both designs using the mode rulebook.'); save(); }
  } catch (error) { status(error.message, true); } finally { busy(false); }
});
$('#play').addEventListener('click', () => { playing = !playing; $('#play').textContent = playing ? 'Pause' : 'Play'; });
$('#seek').addEventListener('input', event => { position = Number(event.target.value) / 1000 * (view?.duration || 0); });
$('#export-replay').addEventListener('click', () => download(`ai-fight-${state.mode}-round-${state.round}.json`, state.replay));
$('#export-builds').addEventListener('click', () => download('ai-fight-builds.json', { mode: state.mode, round: state.round, builds: state.builds }));
$('#guide').addEventListener('click', async () => {
  const dialog = $('#rulebook');
  $('#rulebook-content').textContent = 'Loading rulebook...';
  dialog.showModal();
  try {
    const response = await fetch('./guides/' + modeNames[state.mode], { credentials: 'omit' });
    if (!response.ok) throw new Error('Could not load the rulebook. Close this reader and try again.');
    // Display the original Markdown as text, so guide content never becomes active HTML.
    $('#rulebook-content').textContent = await response.text();
  } catch (error) { $('#rulebook-content').textContent = error.message; }
});
$('#import-builds').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file || sessionId || state.busy) return;
  try {
    if (file.size > 150 * 1024) throw new Error('Build import exceeds 150 KiB');
    const value = JSON.parse(await file.text());
    if (!modeNames[value.mode] || !Number.isInteger(value.round) || value.round < 1 || value.round > 12 || !Array.isArray(value.builds) || value.builds.length !== 2 || value.builds.some(build => !build || typeof build !== 'object' || Array.isArray(build) || Object.entries(build).some(([name, source]) => !/^(?:[a-z]+\.json|brain\.js|commander\.js|strategy\.js|notes\.md|lib\/[\w-]+\.js)$/.test(name) || typeof source !== 'string'))) throw new Error('Invalid build file');
    Object.assign(state, {mode: value.mode, round: value.round, builds: value.builds, memories: null, replay: null }); await catalog(); save(); status('Builds imported. Check them before fighting.');
  } catch (error) { status(error.message, true); }
});
async function applySession(session) {
  if (!modeNames[session.mode]) throw new Error('Unknown session mode');
  state.session = session;
  if (state.mode !== session.mode || state.round !== session.round || !Object.keys(state.builds[0]).length) {
    state.mode = session.mode; state.round = session.round; await catalog(true);
  }
  state.builds = session.builds.map((build, side) => build || state.builds[side]);
  syncEditors(); busy(state.busy);
  if (session.phase === 'ready' && activeRevision !== session.revision) { activeRevision = session.revision; await simulate('fight'); }
  else if (session.phase === 'building') status(`Waiting for agents: ${session.ready.filter(Boolean).length}/2 sides ready. Keep this page open.`);
}
async function poll() {
  try { if (!state.busy) await applySession(await hostRequest('get', { session_id: sessionId })); }
  catch (error) { status(error.message, true); }
  finally { setTimeout(poll, 4000); }
}
function animate(now) {
  const elapsed = Math.min(0.1, (now - (lastFrame || now)) / 1000); lastFrame = now;
  if (view && state.replay) {
    if (playing) position = Math.min(view.duration, position + elapsed * Number($('#speed').value));
    try { view.render(position, now / 1000); } catch (error) { status(`Replay rendering failed: ${error.message}`, true); playing = false; view = null; }
    if (view) { $('#seek').value = view.duration ? position / view.duration * 1000 : 0; $('#clock').textContent = `${Math.floor(position / 60)}:${String(Math.floor(position % 60)).padStart(2, '0')}`; }
  }
  requestAnimationFrame(animate);
}
addEventListener('resize', resize); requestAnimationFrame(animate);
if (sessionId) {
  $('#connection').textContent = 'MCP host session · account required';
  $('#session-id').textContent = 'Session: ' + sessionId;
  busy(false); poll();
} else {
  let restored = false;
  try { const saved = JSON.parse(localStorage.getItem('ai-fight-local-v1')); if (saved && modeNames[saved.mode] && saved.round >= 1 && saved.round <= 12 && saved.builds?.length === 2) { Object.assign(state, saved); await catalog(); restored = true; busy(false); status('Your local builds have been restored.'); } } catch { /* Invalid or unavailable browser storage starts a fresh match. */ }
  if (!restored) await reset();
}
