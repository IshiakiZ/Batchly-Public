// ─────────────────────────────────────────────────────────────────────────────
//  AI FIGHT — spectator app: live connection, tabs + routing, top bar, menu,
//  arena log drawer, host controls, settings / setup / exhibition / help
//  modals, keyboard shortcuts, music.
//
//  Tabs: Live (L) · Fighters (I) · Stats (S) · Replays (W). "Live" shows the
//  build screen while the AIs build (and at match over) and the arena during
//  the countdown, the fight and the round result. Watching a replay is its own
//  view ('replay') that returns to where it was opened from.
// ─────────────────────────────────────────────────────────────────────────────
import { $, h, clear, toast, pref, setPref, setHolds } from './util.js';
import { BuildScreen } from './build.js';
import { ArenaScreen } from './fight.js';
import { ModeArenaScreen } from './modearena.js';
import { StatsScreen } from './stats.js';
import { FightersScreen } from './ui-fighters.js';
import { ReplaysScreen, exhibitionForm } from './ui-replays.js';
import { tabBar, feedItem } from './ui-kit.js';
import { sfx, unlock, isMuted, setMuted, isMusicOn, setMusicOn, getVolume, setVolume, setMusic, musicTrackFor, ui } from './sound.js'; // sound: musicTrackFor, ui

const store = {
  loaded: false,
  config: null,
  rules: null,
  state: null,
  cards: {},
  feeds: {},
  presence: {},
  tests: {},
  match: null,
  prompts: {},
  bots: [],
  themes: [],
  modes: [],
  mode: { id: 'fighter' },
  offset: 0,
  ids: [],
};

const TABS = [
  { id: 'live', label: 'Live', key: 'L', title: 'Live: the build and the fights (L)' },
  { id: 'fighters', label: 'Fighters', key: 'I', title: 'Fighters: everything about each fighter (I)' },
  { id: 'stats', label: 'Stats', key: 'S', title: 'Statistics (S)' },
  { id: 'replays', label: 'Replays', key: 'W', title: 'Replays and exhibitions (W)' },
];

let view = 'live';      // live | fighters | stats | replays | replay
let returnView = 'live'; // where closing a replay goes back to
let activeScreen = null;
let setupShown = false;
let lastMatchId = null;
let replayArena = 'arena'; // which arena screen shows the open replay (fighter or another game mode)
const matchModes = {};    // matchId -> game mode (cached lookups for replays of earlier matches)

// Exhibitions started in this browser session (the server keeps the last 6).
let exhibitions = [];
try { exhibitions = JSON.parse(sessionStorage.getItem('aifight-exh') || '[]') || []; } catch { exhibitions = []; }
function saveExhibitions() { try { sessionStorage.setItem('aifight-exh', JSON.stringify(exhibitions.slice(-12))); } catch { /* ignore */ } }

const api = {
  store,
  serverNow: () => Date.now() + store.offset,
  fighter: (id) => store.config.fighters.find(f => f.id === id),
  side: (id) => store.config.fighters.findIndex(f => f.id === id),
  async host(action, confirmText, body) {
    if (confirmText && !(await confirmModal(confirmText))) return null;
    try {
      const r = await fetch(`/api/host/${action}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) toast(j.message || j.error || 'That did not work', 'error');
      return j;
    } catch {
      toast('Could not reach the arena server', 'error');
      return null;
    }
  },
  go: (v, opts) => go(v, opts),
  isLive: () => view === 'live',
  showStats() { go('stats'); },
  showLive() { go('live'); },
  openReplay(matchId, round) { openReplayOf(matchId, round); },
  newMatch: () => openNewMatch(),
  openExhibition(id) { replayArena = 'arena'; enterReplay(); arena.openExhibition(id); },
  closeReplay() { go(returnView || 'live'); },
  openExhibitionPicker: () => openExhibition(),
  openSetup: () => openSetup(),
  route: () => route(),
  toggleLog: (on) => toggleLog(on),
  logUnread: () => log.unread,
  exhibitions: () => exhibitions,
  async startExhibition(a, b, level, title) {
    try {
      const r = await fetch('/api/exhibition', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a, b, level }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) { toast(j.message || 'The exhibition could not start', 'error'); return null; }
      exhibitions.push({ id: j.id, level, at: Date.now(), title: String(title || '').replace(/Bot: /g, '') });
      saveExhibitions();
      replays.invalidate();
      return j;
    } catch {
      toast('Could not reach the arena server', 'error');
      return null;
    }
  },
};

const build = new BuildScreen(api);
const arena = new ArenaScreen(api);
const stats = new StatsScreen(api);
const fighters = new FightersScreen(api);
const replays = new ReplaysScreen(api);
const modeArena = new ModeArenaScreen(api);
const SCREENS = { build, arena, modearena: modeArena, fighters, stats, replays };
window.__aifight = { api, build, arena, modeArena, stats, fighters, replays }; // handy for debugging in the console

/** True when the current match is another game mode (army, business…) rather than the fighter duel. */
function otherModeMatch() { return !!(store.state && store.state.mode && store.state.mode !== 'fighter'); }

// Replays open in the arena of their own game mode.
async function openReplayOf(matchId, round) {
  let mode = store.state && store.state.matchId === matchId ? (store.state.mode || 'fighter') : matchModes[matchId];
  if (!mode) {
    try { const r = await fetch(`/api/match/${encodeURIComponent(matchId)}`); const j = r.ok ? await r.json() : null; mode = (j && j.mode) || 'fighter'; } catch { mode = 'fighter'; }
    matchModes[matchId] = mode;
  }
  replayArena = mode === 'fighter' ? 'arena' : 'modearena';
  enterReplay();
  if (replayArena === 'modearena') modeArena.openReplay(matchId, round); else arena.openReplay(matchId, round);
}

// ── routing ──────────────────────────────────────────────────────────────────
function screenFor() {
  if (view === 'fighters' || view === 'stats' || view === 'replays') return view;
  if (view === 'replay') return replayArena;
  const ph = store.state.phase;
  if (ph === 'building' || ph === 'match_over') return 'build';
  return otherModeMatch() ? 'modearena' : 'arena';
}

function tabFor(v) { return v === 'replay' ? 'replays' : v; }

function go(v, opts) {
  if (!TABS.some(t => t.id === v) && v !== 'replay') v = 'live';
  const same = v === view;
  view = v;
  route(opts, same);
}

function enterReplay() {
  if (view !== 'replay') returnView = view;
  view = 'replay';
  route();
}

function route(opts, forceEnter = false) {
  if (!store.loaded) return;
  const name = screenFor();
  for (const [k, s] of Object.entries(SCREENS)) {
    const el = document.getElementById(`screen-${k}`);
    el.classList.toggle('active', k === name);
    if (k !== name && s === activeScreen && s.leave) s.leave();
  }
  const next = SCREENS[name];
  if (next !== activeScreen || (opts && forceEnter)) {
    activeScreen = next;
    if (next.enter) next.enter(name === 'arena' ? view : opts);
  } else if (next.refresh) next.refresh(view);
  mainTabs.select(tabFor(view), true);
  document.body.dataset.view = view;
  document.body.dataset.screen = name;
  renderScoreboard();
  updateMusic();
}

// Background music follows the screen: calm while building, loud while fighting,
// silence on the result card so the fanfare and the crowd can breathe.
// sound: every arena has its own songs (rotating by match, never the same song twice in a match),
// build songs change by round, the menu rotates, army / business matches use their mode's songs.
function updateMusic() {
  if (!store.loaded) return;
  const name = screenFor();
  const s = store.state;
  const ph = s.phase;
  const onArena = name === 'arena' || name === 'modearena';
  const sRep = view === 'replay' ? (name === 'modearena' ? modeArena : arena).replay : null;
  const themes = Array.isArray(store.themes) ? store.themes : [];
  const base = {
    level: s.level || s.round || 1, round: s.round || 1, matchNumber: s.matchNumber || 1, theme: s.theme, mode: s.mode || 'fighter',
    rotation: themes.filter(t => t && !t.godly).length, finalRound: store.config && store.config.finalRound,
  };
  let o;
  if (onArena && sRep) {
    o = Object.assign({}, base, { phase: 'replay', live: false, level: sRep.level || sRep.round || base.level, round: sRep.round || base.round,
      theme: sRep.theme || null, mode: sRep.mode || 'fighter', matchNumber: sRep.matchNumber || base.matchNumber });
  } else if (onArena && (view === 'replay' || ph === 'countdown' || ph === 'fighting')) {
    o = Object.assign({}, base, { phase: ph === 'countdown' ? 'countdown' : 'fighting', live: view !== 'replay' });
  } else if (onArena) o = { phase: 'round_over' }; // result card: silence, the stingers play
  else if (ph === 'match_over') o = Object.assign({}, base, { phase: 'match_over' });
  else if (ph === 'building' && s.clockInfo && s.clockInfo.enabled && !s.clockInfo.started) o = { phase: 'menu' }; // idle until the build clock starts
  else o = Object.assign({}, base, { phase: 'building' });
  setMusic(musicTrackFor(o));
}

// ── top bar ──────────────────────────────────────────────────────────────────
const PHASE_LABEL = { building: 'Building', countdown: 'Get ready', fighting: 'Fight!', round_over: 'Round over', match_over: 'Match over' };

const mainTabs = tabBar(TABS.map(t => ({ id: t.id, label: t.label, title: t.title })), {
  active: 'live', cls: 'main-tabs', label: 'Main',
  onSelect: (id) => { ui('tab'); go(id); }, // sound: tab switch
});
$('#main-tabs').replaceWith(mainTabs.el);
mainTabs.el.id = 'main-tabs';
const liveDot = h('span', { class: 'live-dot', 'aria-hidden': 'true' });
mainTabs.button('live').prepend(liveDot);

function renderScoreboard() {
  const sb = clear($('#scoreboard'));
  if (!store.loaded) return;
  const [a, b] = store.config.fighters;
  const s = store.state;
  liveDot.className = `live-dot ph-${s.phase}`;
  const clockTxt = s.phase === 'building' ? build.clockText() : null;
  sb.append(
    h('div', { class: 'sb-side', style: `--c:${a.color}` }, h('span', { class: 'sb-dot' }), h('span', { class: 'sb-label' }, a.label.toUpperCase())),
    h('div', { class: 'sb-mid' },
      h('div', { class: 'sb-score', title: 'Rounds won' }, String(s.score[a.id] || 0), h('small', null, '–'), String(s.score[b.id] || 0)),
      h('div', { class: 'sb-meta' }, `Match ${s.matchNumber} · R${s.round} · ${PHASE_LABEL[s.phase] || s.phase}`, clockTxt ? h('span', { class: 'sb-clock' }, ` · ${clockTxt}`) : null, s.score.draws ? ` · ${s.score.draws}D` : '')),
    h('div', { class: 'sb-side', style: `--c:${b.color}` }, h('span', { class: 'sb-label' }, b.label.toUpperCase()), h('span', { class: 'sb-dot' })),
  );
}

function setConn(kind, text) {
  const el = $('#conn');
  el.className = `conn ${kind}`;
  el.title = `Connection to the arena server: ${text}`;
  el.querySelector('b').textContent = text;
}

function syncSoundButton() {
  const b = $('#btn-sound');
  b.textContent = isMuted() ? '🔇' : '🔊';
  b.title = isMuted() ? 'Sound is off (M)' : 'Sound is on (M)';
  b.setAttribute('aria-pressed', isMuted() ? 'false' : 'true');
}

// ── display preferences (per browser) ───────────────────────────────────────
function applyCrt(on) { document.body.classList.toggle('crt', on); setPref('aifight-crt', on); }
applyCrt(pref('aifight-crt', false));

// ── the ☰ menu ──────────────────────────────────────────────────────────────
const MENU = [
  { id: 'newmatch', icon: '＋', label: 'New match…', run: () => openNewMatch() },
  { id: 'exhibition', icon: '🎮', label: 'Exhibition match', key: 'X', run: () => openExhibition() },
  { id: 'setup', icon: '📋', label: 'Setup & prompts', run: () => openSetup() },
  { id: 'log', icon: '≡', label: 'Arena log', key: 'G', run: () => toggleLog(true) },
  { id: 'settings', icon: '⚙', label: 'Settings', run: () => openSettings() },
  { id: 'help', icon: '⌨', label: 'Keyboard shortcuts', key: '?', run: () => openHelp() },
];
const menuBtn = $('#btn-menu');
const menuEl = $('#menu');
function buildMenu() {
  clear(menuEl).append(...MENU.map(m => h('button', { class: 'menu-item', role: 'menuitem', type: 'button', tabindex: '-1', onclick: () => { closeMenu(); m.run(); } },
    h('span', { class: 'mi-ic', 'aria-hidden': 'true' }, m.icon), h('span', { class: 'mi-lbl' }, m.label), m.key ? h('kbd', null, m.key) : null)));
}
function openMenu() {
  buildMenu();
  menuEl.hidden = false;
  menuBtn.setAttribute('aria-expanded', 'true');
  const first = menuEl.querySelector('.menu-item');
  if (first) first.focus();
}
function closeMenu(focusBtn = false) {
  if (menuEl.hidden) return;
  menuEl.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
  if (focusBtn) menuBtn.focus();
}
menuBtn.addEventListener('click', () => (menuEl.hidden ? openMenu() : closeMenu()));
menuEl.addEventListener('keydown', (e) => {
  const items = Array.from(menuEl.querySelectorAll('.menu-item'));
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
  else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
  else if (e.key === 'Tab') closeMenu();
});
document.addEventListener('pointerdown', (e) => { if (!menuEl.hidden && !menuEl.contains(e.target) && e.target !== menuBtn && !menuBtn.contains(e.target)) closeMenu(); });

// ── arena log drawer ────────────────────────────────────────────────────────
const log = { open: false, filter: 'all', unread: 0 };
const drawer = $('#drawer');
function logWho(f) {
  if (f.who === 'system') return null;
  const ai = store.config && store.config.fighters.find(x => x.id === f.who);
  return ai ? { label: ai.label, color: ai.color } : { label: f.who, color: '#8a92b0' };
}
function logEntries() {
  const all = [];
  for (const [who, list] of Object.entries(store.feeds || {})) for (const f of list || []) all.push(Object.assign({ who }, f));
  all.sort((p, q) => (p.n && q.n ? p.n - q.n : p.at - q.at));
  return all.filter(f => log.filter === 'all' || (log.filter === 'system' ? f.who === 'system' : f.who === log.filter));
}
function renderLog() {
  if (!log.open || !store.loaded) return;
  const filters = [{ id: 'all', label: 'All' }, { id: 'system', label: 'Arena' }, ...store.config.fighters.map(f => ({ id: f.id, label: f.label, color: f.color }))];
  const list = h('div', { class: 'feed drawer-list', role: 'log' });
  const items = logEntries().slice(-200);
  if (!items.length) list.append(h('div', { class: 'empty-note' }, 'Nothing here yet.'));
  for (let i = items.length - 1; i >= 0; i--) list.append(feedItem(items[i], { who: logWho(items[i]) }));
  clear(drawer).append(
    h('div', { class: 'drawer-head' },
      h('h2', null, 'Arena log'),
      h('span', { class: 'sp' }),
      h('button', { class: 'icon-btn', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close the arena log', onclick: () => toggleLog(false) }, '✕')),
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Filter' }, filters.map(f => h('button', {
      class: `seg-btn${log.filter === f.id ? ' on' : ''}`, type: 'button', 'aria-pressed': log.filter === f.id ? 'true' : 'false', style: f.color ? `--c:${f.color}` : null,
      onclick: () => { log.filter = f.id; renderLog(); },
    }, f.color ? h('i', { class: 'dot' }) : null, f.label))),
    list);
}
function toggleLog(on = !log.open) {
  log.open = on;
  drawer.hidden = !on;
  document.body.classList.toggle('drawer-open', on);
  if (on) { log.unread = 0; renderLog(); build.renderCenter(); const c = drawer.querySelector('.icon-btn'); if (c) c.focus(); }
}

// ── modals ───────────────────────────────────────────────────────────────────
let modalReturn = null;
function closeModal() {
  clear($('#modal-root'));
  if (modalReturn && modalReturn.isConnected) modalReturn.focus();
  modalReturn = null;
}

function modal(content, { small = false, onClose, label = 'Dialog' } = {}) {
  const root = clear($('#modal-root'));
  ui('open'); // sound: menu / dialog open
  modalReturn = document.activeElement;
  const box = h('div', { class: `modal${small ? ' small' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabindex: '-1' }, content);
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) { closeModal(); onClose && onClose(); } } }, box);
  root.appendChild(back);
  const focusable = box.querySelector('button.primary, button, input, select, a');
  (focusable || box).focus();
  return box;
}

/** New match: pick the game mode (the fighter duel, an army battle, a business race…). */
function openNewMatch() {
  const list = (store.modes || []).filter(m => m.available !== false);
  const cur = (store.state && store.state.mode) || 'fighter';
  let pick = cur;
  const cards = list.map(m => h('button', {
    class: `mode-pick${m.id === pick ? ' on' : ''}`, type: 'button', 'data-id': m.id, 'aria-pressed': m.id === pick ? 'true' : 'false',
    onclick: (e) => { pick = m.id; for (const b of e.currentTarget.parentNode.children) { const on = b.dataset.id === pick; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); } },
  }, h('b', null, m.name), h('span', null, m.tagline || '')));
  modal([
    h('h2', null, 'New match'),
    h('p', { class: 'lead' }, 'Pick the game mode. Round numbers and the score reset (all-time stats are kept), both AIs get fresh starter files, and you paste the prompts into both AIs again (Setup & prompts).'),
    h('div', { class: 'mode-picks' }, cards),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => { closeModal(); const r = await api.host('new-match', null, { mode: pick }); if (r && r.ok) setTimeout(() => openSetup(), 600); } }, 'Start the match')),
  ], { label: 'New match' });
}

function confirmModal(text) {
  return new Promise((resolve) => {
    const done = (v) => { closeModal(); resolve(v); };
    modal([
      h('h2', null, 'Are you sure?'),
      h('p', { class: 'lead' }, text),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn ghost', onclick: () => done(false) }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => done(true) }, 'Yes, do it')),
    ], { small: true, onClose: () => resolve(false), label: 'Confirm' });
  });
}

function copyText(text, btn) {
  const ok = () => { btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = 'Copy prompt'; }, 1600); };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, () => fallbackCopy(text, ok));
  else fallbackCopy(text, ok);
}
function fallbackCopy(text, ok) {
  const ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0' });
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); ok(); } catch { toast('Select the text and copy it manually', 'error'); }
  ta.remove();
}

function openSetup() {
  const fs = store.config.fighters;
  const s = store.state.settings || {};
  const lim = (sec) => (sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : 'no limit');
  modal([
    h('h2', null, 'Setup — start both AIs at the same time'),
    h('p', { class: 'lead' }, 'Each AI designs its own fighter while you watch. Connect both agents to Batchly MCP with separate creator tokens on your account and paste one prompt into each.'),
    h('ol', { class: 'steps' },
      h('li', null, 'Open ', h('b', null, 'Claude'), ' connected to Batchly MCP and paste the ', h('b', null, fs[0].label), ' prompt.'),
      h('li', null, 'Open ', h('b', null, 'ChatGPT or Codex'), ' connected to Batchly MCP and paste the ', h('b', null, fs[1].label), ' prompt. Both agents must use the same session ID.'),
      h('li', null, h('b', null, 'Round 1 is a mirror match'), ': both start as the identical Rookie and can only change its fighting brain. The fight starts by itself once both lock in.'),
      h('li', null, h('b', null, `Build time limit: round 1 ${lim(s.firstRoundLimitSec)}, later rounds ${lim(s.roundLimitSec)}`), ' — each round the clock starts as soon as either AI starts working; when it runs out, whatever each AI has is auto-locked. Change it in ☰ Menu → Settings.'),
      h('li', null, 'After each round press ', h('b', null, 'Next round'), ' — both AIs level up and evolve their fighters (stats, weapon, traits, abilities, look) — or ', h('b', null, 'End match'), ' for the final stats.'),
    ),
    h('div', { class: 'prompt-grid' }, fs.map(f => {
      const text = store.prompts[f.id] || '';
      const btn = h('button', { class: 'btn small', onclick: () => copyText(text, btn) }, 'Copy prompt');
      return h('div', { class: 'prompt-box', style: `--c:${f.color}` },
        h('div', { class: 'pb-h' }, h('b', null, f.label.toUpperCase()), h('span', null, `fighters/${f.id}/`), btn),
        h('pre', null, text));
    })),
    h('div', { class: 'foot' },
      h('span', null, 'Keep the signed-in host open. Creator tools provide ', h('code', null, 'mode_help'), '. The AIs read the linked ', h('code', null, 'AI_GUIDE.md'), ' for the full rules.'),
      h('button', { class: 'btn primary', onclick: closeModal }, 'Got it')),
  ], { label: 'Setup and prompts' });
}

// ── settings ────────────────────────────────────────────────────────────────
function openSettings() {
  const s = store.state.settings || { firstRoundLimitSec: 360, roundLimitSec: 300 };
  const timeInputs = (sec, label) => {
    const m = h('input', { type: 'number', min: '0', max: '120', value: String(Math.floor(sec / 60)), 'aria-label': `${label} minutes` });
    const ss = h('input', { type: 'number', min: '0', max: '59', value: String(sec % 60), 'aria-label': `${label} seconds` });
    return { m, ss, el: h('span', { class: 'tin' }, m, h('span', null, 'min'), ss, h('span', null, 'sec')), val: () => (Math.max(0, Number(m.value) || 0) * 60) + Math.max(0, Math.min(59, Number(ss.value) || 0)) };
  };
  const first = timeInputs(s.firstRoundLimitSec || 0, 'Round 1');
  const later = timeInputs(s.roundLimitSec || 0, 'Later rounds');
  const check = (on, onChange) => { const c = h('input', { type: 'checkbox' }); c.checked = on; c.addEventListener('change', () => onChange(c.checked)); return c; };
  const sound = check(!isMuted(), (on) => { setMuted(!on); syncSoundButton(); if (on) sfx.click(); });
  const music = check(isMusicOn(), (on) => setMusicOn(on));
  const crt = check(document.body.classList.contains('crt'), (on) => applyCrt(on));
  const thoughts = check(arena.debug, (on) => arena.toggleDebug(on));
  const details = check(arena.details, (on) => arena.toggleDetails(on));
  const freeze = check(s.impactFreeze !== false, async (on) => {
    const r = await api.host('settings', null, { impactFreeze: on });
    if (r && r.ok) toast(`Impact freezes ${on ? 'on' : 'off'}`, 'ok');
  });
  const vol = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(getVolume()), 'aria-label': 'Volume' });
  vol.addEventListener('input', () => setVolume(vol.value));
  vol.addEventListener('change', () => sfx.hit(40));
  const save = async () => {
    const r = await api.host('settings', null, { firstRoundLimitSec: first.val(), roundLimitSec: later.val() });
    if (r && r.ok) { toast('Time limits saved', 'ok'); closeModal(); }
  };
  modal([
    h('h2', null, '⚙ Settings'),
    h('div', { class: 'set-grid' },
      h('section', null,
        h('h3', null, 'Build time limit'),
        h('p', { class: 'hint' }, 'How long each AI gets to build or evolve before the arena auto-locks its fighter (0 = no limit). Each round the clock starts as soon as either AI starts working (or when you press Start).'),
        h('label', { class: 'set-row' }, h('span', null, 'Round 1'), first.el),
        h('label', { class: 'set-row' }, h('span', null, 'Later rounds'), later.el),
        h('div', { class: 'row-actions left' },
          h('button', { class: 'btn primary', onclick: save }, 'Save time limits'),
          h('button', { class: 'btn ghost', onclick: () => { first.m.value = '6'; first.ss.value = '0'; later.m.value = '5'; later.ss.value = '0'; } }, 'Defaults (6:00 / 5:00)')),
        h('h3', null, 'Results'),
        h('p', { class: 'hint' }, 'Every round is appended to results/rounds.csv and every finished match to results/matches.csv (opens in Excel / Google Sheets).'),
        h('div', { class: 'row-actions left' },
          h('a', { class: 'btn', href: '/api/csv/rounds', download: 'ai-fight-rounds.csv' }, '⬇ rounds.csv'),
          h('a', { class: 'btn', href: '/api/csv/matches', download: 'ai-fight-matches.csv' }, '⬇ matches.csv'))),
      h('section', null,
        h('h3', null, 'Sound'),
        h('label', { class: 'set-row check' }, sound, h('span', null, 'Sound effects & music (M)')),
        h('label', { class: 'set-row check' }, music, h('span', null, 'Background music')),
        h('label', { class: 'set-row' }, h('span', null, 'Volume'), vol),
        h('h3', null, 'Display'),
        h('label', { class: 'set-row check' }, thoughts, h('span', null, 'Show AI thoughts in fights (B)')),
        h('label', { class: 'set-row check' }, details, h('span', null, 'Detail panels beside the arena (D)')),
        h('label', { class: 'set-row check' }, freeze, h('span', null, 'Impact freezes: a short hit-stop on huge hits and the K.O.')),
        h('label', { class: 'set-row check' }, crt, h('span', null, 'CRT scanlines (C)')),
        h('p', { class: 'hint' }, 'Music and most sound effects are from Epidemic Sound (public/audio/CREDITS.md).'))),
    h('div', { class: 'row-actions' }, h('button', { class: 'btn ghost', onclick: closeModal }, 'Close')),
  ], { label: 'Settings' });
}

// ── exhibition ──────────────────────────────────────────────────────────────
function openExhibition() {
  modal([
    h('h2', null, '🎮 Exhibition match'),
    h('p', { class: 'lead' }, 'Pit any two fighters against each other for fun — sparring bots or the AIs’ current fighters. It doesn’t count for the score and the AIs never see it.'),
    exhibitionForm(api, { onCancel: closeModal, onStarted: (r) => { closeModal(); api.openExhibition(r.id); } }),
    h('p', { class: 'hint', style: 'margin-top:14px' }, 'Past exhibitions of this session are in the Replays tab (W).'),
  ], { label: 'Exhibition match' });
}

// ── keyboard help ───────────────────────────────────────────────────────────
function openHelp() {
  const groups = [
    ['Navigate', [['L', 'Live'], ['I', 'Fighters'], ['S', 'Stats (again: back)'], ['W', 'Replays'], ['[  ]', 'Previous / next tab'], ['← →', 'Move between tabs when a tab is focused'], ['G', 'Arena log'], ['Esc', 'Close / back']]],
    ['Match', [['N', 'Next round (after a fight)'], ['E', 'End the match'], ['F', 'Force start'], ['1 / 2', 'Predict the winner (while building)'], ['X', 'Exhibition match']]],
    ['Build clock', [['P', 'Start / pause / resume'], ['T', 'Add 1 minute']]],
    ['Arena & replays', [['R', 'Replay the last round'], ['Space', 'Play / pause a replay'], ['B', 'Show AI thoughts'], ['D', 'Detail panels']]],
    ['Sound & look', [['M', 'Mute / unmute'], ['C', 'CRT scanlines'], ['?', 'This help']]],
  ];
  modal([
    h('h2', null, '⌨ Keyboard shortcuts'),
    h('div', { class: 'keys-grid' }, groups.map(([title, keys]) => h('section', null, h('h3', null, title),
      h('div', { class: 'keys' }, keys.map(([k, t]) => h('div', null, h('kbd', null, k), h('span', null, t))))))),
    h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', onclick: closeModal }, 'Got it')),
  ], { label: 'Keyboard shortcuts' });
}

// ── live connection ──────────────────────────────────────────────────────────
function applyBootstrap(d) {
  store.config = d.config;
  store.rules = d.rules;
  store.state = d.state;
  setHolds(!(d.state && d.state.settings && d.state.settings.impactFreeze === false));
  store.cards = d.cards || {};
  store.feeds = d.feeds || {};
  store.presence = d.presence || {};
  store.tests = d.tests || {};
  store.match = d.match;
  store.prompts = d.prompts || {};
  store.bots = d.bots || [];
  store.themes = d.themes || [];
  store.modes = d.modes || [{ id: 'fighter', name: 'Fighter Duel', available: true }];
  store.mode = d.mode || { id: 'fighter' };
  store.ids = d.config.fighters.map(f => f.id);
  store.offset = d.serverTime - Date.now();
  const [a, b] = d.config.fighters;
  document.documentElement.style.setProperty('--a', a.color);
  document.documentElement.style.setProperty('--b', b.color);
  const first = !store.loaded;
  const newMatch = !first && lastMatchId && lastMatchId !== d.state.matchId;
  lastMatchId = d.state.matchId;
  store.loaded = true;
  if (first && d.state.phase === 'match_over') view = 'stats';
  if (newMatch) ui('newmatch'); // sound: new match gong
  if (newMatch) { view = 'live'; toast(`Match ${d.state.matchNumber} started — ${store.mode && store.mode.id !== 'fighter' ? `${store.mode.name}: both AIs start from the same starter files` : 'both AIs begin with the Rookie again'}`, 'ok'); }
  build.renderAll();
  stats.invalidate();
  fighters.invalidate();
  replays.invalidate();
  arena.onState(null);
  modeArena.onState(null);
  route(null, true);
  renderLog();
  const nothingYet = d.state.round === 1 && d.state.phase === 'building'
    && store.ids.every(id => !(store.cards[id] && store.cards[id].revision > 0) && !(d.state.fighters[id] || {}).ready);
  if (nothingYet && !setupShown) {
    setupShown = true;
    let seen = false;
    try { seen = sessionStorage.getItem('aifight-setup') === '1'; sessionStorage.setItem('aifight-setup', '1'); } catch { /* ignore */ }
    if (!seen) openSetup();
  }
}

function connect() {
  const es = new EventSource('/events');
  es.addEventListener('open', () => setConn('ok', 'live'));
  es.addEventListener('error', () => setConn('down', 'reconnecting…'));
  es.addEventListener('bootstrap', (e) => applyBootstrap(JSON.parse(e.data)));
  es.addEventListener('state', (e) => {
    const s = JSON.parse(e.data);
    const prev = store.state;
    store.offset = s.serverTime - Date.now();
    store.state = s;
    setHolds(!(s && s.settings && s.settings.impactFreeze === false));
    if (prev && prev.matchId !== s.matchId) { view = 'live'; }
    else if (prev && prev.phase === 'building' && s.phase === 'countdown') {
      // The fight is the main event: bring the host to it (unless they're watching a replay).
      if (view === 'replay') toast(`Round ${s.round} is starting!`, 'info', 9000, { label: 'Watch live', onClick: () => go('live') });
      else if (view !== 'live') { view = 'live'; toast(`Round ${s.round} — the fight is starting!`); }
    } else if (prev && prev.phase !== 'match_over' && s.phase === 'match_over' && view === 'live') {
      view = 'stats';
      stats.show('overview');
    }
    if (prev && prev.phase !== 'match_over' && s.phase === 'match_over') ui('matchover'); // sound: match over sting
    if (prev && prev.prediction !== s.prediction && s.prediction) ui('predict'); // sound: prediction made
    build.onState(prev);
    arena.onState(prev);
    modeArena.onState(prev);
    stats.invalidate();
    fighters.invalidate();
    replays.invalidate();
    route();
  });
  es.addEventListener('card', (e) => {
    const c = JSON.parse(e.data);
    store.cards[c.id] = c;
    build.onCard(c.id);
    fighters.onCard(c.id, activeScreen === fighters);
  });
  es.addEventListener('feed', (e) => {
    const f = JSON.parse(e.data);
    const list = store.feeds[f.who] || (store.feeds[f.who] = []);
    list.push(f);
    if (list.length > 120) list.splice(0, list.length - 120);
    build.onFeed(f);
    // bursts of feed events are drawn at most every ~200 ms (no flicker)
    if (log.open) { if (!log.timer) log.timer = setTimeout(() => { log.timer = null; renderLog(); }, 200); }
    else if (f.who === 'system') { log.unread++; if (activeScreen === build && !log.cTimer) log.cTimer = setTimeout(() => { log.cTimer = null; build.renderCenter(); }, 200); }
  });
  es.addEventListener('activity', (e) => {
    const { id, activity } = JSON.parse(e.data);
    if (store.state) {
      store.state.activity = store.state.activity || {};
      store.state.activity[id] = activity;
    }
    build.onActivity(id);
  });
  es.addEventListener('presence', (e) => {
    const { id, presence } = JSON.parse(e.data);
    store.presence[id] = presence;
    build.onPresence(id);
    arena.onPresence(id);
  });
  es.addEventListener('test', (e) => {
    const { id, test } = JSON.parse(e.data);
    store.tests[id] = test;
    build.onTest(id);
  });
  es.addEventListener('match', (e) => {
    store.match = JSON.parse(e.data);
    stats.invalidate();
    fighters.invalidate();
    replays.invalidate();
    arena.onMatch();
    if (activeScreen && activeScreen.refresh) activeScreen.refresh(view);
  });
  es.addEventListener('toast', (e) => { const t = JSON.parse(e.data); toast(t.text, t.level === 'error' ? 'error' : 'info'); });
}

// ── wiring ───────────────────────────────────────────────────────────────────
$('#btn-sound').addEventListener('click', () => { setMuted(!isMuted()); syncSoundButton(); if (!isMuted()) sfx.click(); });
$('#brand').addEventListener('click', () => go('live'));
syncSoundButton();

// Browsers only start audio after a user gesture.
const firstGesture = () => { unlock(); updateMusic(); };
window.addEventListener('pointerdown', firstGesture);
window.addEventListener('keydown', firstGesture);

function cycleTab(dir) {
  const ids = TABS.map(t => t.id);
  const i = Math.max(0, ids.indexOf(tabFor(view)));
  go(ids[(i + dir + ids.length) % ids.length]);
}

document.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') {
    if (!menuEl.hidden) { closeMenu(true); return; }
    if ($('#modal-root').firstChild) { closeModal(); return; }
    if (log.open) { toggleLog(false); return; }
    if (view === 'replay') { go(returnView || 'live'); return; }
    if (view !== 'live') go('live');
    return;
  }
  if ($('#modal-root').firstChild || !store.loaded || !menuEl.hidden) return;
  // Space / Enter on a focused button should click it, not trigger shortcuts.
  if ((e.key === ' ' || e.key === 'Enter') && tag === 'BUTTON' && !(e.key === ' ' && ((activeScreen === arena && arena.mode === 'replay') || (activeScreen === modeArena && modeArena.mode === 'replay')))) return;
  const st = store.state;
  const ph = st.phase;
  const k = e.key.toLowerCase();
  if (k === 'n' && ph === 'round_over' && view === 'live') api.host('next');
  else if (k === 'e' && (ph === 'round_over' || ph === 'building') && view === 'live') api.host('end', 'End the match and show the final statistics? The AIs will be told to stop.');
  else if (k === 's') go(view === 'stats' ? 'live' : 'stats');
  else if (k === 'l') go('live');
  else if (k === 'i') go('fighters');
  else if (k === 'w') go('replays');
  else if (e.key === ']') cycleTab(1);
  else if (e.key === '[') cycleTab(-1);
  else if (k === 'g') toggleLog();
  else if (k === 'r' && (ph === 'round_over' || ph === 'match_over' || ph === 'building')) {
    const last = store.match && store.match.rounds[store.match.rounds.length - 1];
    if (last) api.openReplay(store.match.matchId, last.round);
    else toast('No round has been fought yet');
  }
  else if (k === 'x') openExhibition();
  else if (k === '?' || (k === '/' && e.shiftKey)) openHelp();
  else if (k === 'm') { setMuted(!isMuted()); syncSoundButton(); toast(isMuted() ? 'Sound off' : 'Sound on'); }
  else if (k === 'c') applyCrt(!document.body.classList.contains('crt'));
  else if (k === 'b') { arena.toggleDebug(); toast(`AI thoughts ${arena.debug ? 'on' : 'off'}${screenFor() === 'arena' ? '' : ' (shown in the arena)'}`); }
  else if (k === 'd') { arena.toggleDetails(); toast(`Detail panels ${arena.details ? 'on' : 'off'}${screenFor() === 'arena' ? '' : ' (shown in the arena)'}`); }
  else if (k === 'p' && ph === 'building') {
    const c = st.clockInfo || {};
    if (c.enabled && !c.expired) api.host(!c.started ? 'clock-start' : c.paused ? 'clock-resume' : 'clock-pause');
  }
  else if (k === 't' && ph === 'building') api.host('clock-add');
  else if ((k === '1' || k === '2') && ph === 'building') {
    const f = store.config.fighters[Number(k) - 1];
    api.host('predict', null, { id: st.prediction === f.id ? null : f.id });
  }
  else if (k === 'f' && ph === 'building') api.host('force-start', 'Start the fight now with each AI’s current files (even if they haven’t marked ready)?');
  else if (k === ' ' && activeScreen === arena && arena.mode === 'replay') { e.preventDefault(); arena.togglePlay(); }
  else if (k === ' ' && activeScreen === modeArena && modeArena.mode === 'replay') { e.preventDefault(); modeArena.togglePlay(); }
});

// Canvas text needs the pixel font loaded before it is drawn.
if (document.fonts && document.fonts.load) {
  document.fonts.load('8px "Press Start 2P"').catch(() => {});
  document.fonts.load('16px "VT323"').catch(() => {});
}

function loop(now) {
  if (store.loaded && activeScreen && activeScreen.tick) {
    try { activeScreen.tick(now); } catch (err) { console.error(err); }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

setInterval(() => {
  if (!store.loaded) return;
  // The build clock warnings (alarm at 1:00, ticks in the last 10 s) play on every tab.
  if (store.state.phase === 'building') { build.slowTick(); renderScoreboard(); }
  updateMusic();
}, 1000);

connect();
