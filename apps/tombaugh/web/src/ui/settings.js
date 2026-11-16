// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

/**
 * Settings: one small window with a few switches. Sound, music, the spoken tour and the "?"
 * help buttons can each be turned off. The choices are kept in this browser.
 *
 * The switches write to the page root (data-help, data-music, data-voice); the styles and the
 * sound module read them there.
 */
import { h } from './layout.js';
import { makeSwitch } from './controls.js';

const KEY = 'tombaugh.settings';
export const DEFAULTS = Object.freeze({ help: true, music: true, voice: true });

/** loadSettings(win) -> { help, music, voice }: the saved choices over the defaults. */
export function loadSettings(win) {
  const out = { ...DEFAULTS };
  try {
    const saved = JSON.parse(win.localStorage.getItem(KEY) || '{}');
    for (const k of Object.keys(DEFAULTS)) if (typeof saved[k] === 'boolean') out[k] = saved[k];
  } catch {
    /* no storage, or nothing readable in it: the defaults stand */
  }
  return out;
}

/** applySettings(doc, s): write the choices on the page root. */
export function applySettings(doc, s) {
  const root = doc.documentElement;
  root.dataset.help = s.help ? 'on' : 'off';
  root.dataset.music = s.music ? 'on' : 'off';
  root.dataset.voice = s.voice ? 'on' : 'off';
}

const GEAR =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
  '<path d="M5 7h7M16 7h3M5 12h2M11 12h8M5 17h9M18 17h1"/>' +
  '<circle cx="14" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="16" cy="17" r="2"/></svg>';

/**
 * createSettings({ win, doc, sound }) -> { open(), get(), destroy() }
 * Puts a Settings button beside every Sound button and opens the window from it.
 */
export function createSettings({ win = typeof window !== 'undefined' ? window : null, doc = typeof document !== 'undefined' ? document : null, sound = null } = {}) {
  if (!win || !doc) return null;
  const state = loadSettings(win);
  applySettings(doc, state);
  const save = () => {
    applySettings(doc, state);
    try {
      win.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* kept for this visit only */
    }
  };

  const flag = (key, label) => {
    const sw = makeSwitch({
      label,
      checked: state[key],
      onChange: (on) => {
        state[key] = on;
        sw.set(on);
        save();
      },
    });
    return sw;
  };
  const soundSw = makeSwitch({
    label: 'Sound',
    checked: sound ? !sound.muted() : false,
    onChange: (on) => {
      if (sound) sound.setMuted(!on);
      soundSw.set(on);
    },
  });
  const rows = [soundSw, flag('music', 'Music'), flag('voice', 'Spoken tour'), flag('help', 'Help buttons')];

  const close = h('button', { class: 'btn btn-quiet', type: 'button', 'aria-label': 'Close settings' }, 'Done');
  const dialog = h(
    'dialog',
    { class: 'dialog settings-dialog', 'aria-labelledby': 'settings-title' },
    h('div', { class: 'dialog-head' }, h('h2', { class: 'dialog-title', id: 'settings-title' }, 'Settings'), close),
    h('div', { class: 'dialog-body settings-body' }, ...rows.map((r) => r.el)),
  );
  doc.body.append(dialog);
  const shut = () => {
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
  };
  close.addEventListener('click', shut);
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) shut(); // a press on the dimmed page around the window
  });

  function open() {
    soundSw.set(sound ? !sound.muted() : false);
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  // One Settings button beside each Sound button, wherever the page puts one.
  function refresh() {
    for (const s of doc.querySelectorAll('.sound-toggle')) {
      const next = s.nextElementSibling;
      if (next && next.classList.contains('settings-toggle')) continue;
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = s.className.replace(/\bsound-toggle\b|\bis-muted\b/g, '').trim() + ' settings-toggle';
      btn.setAttribute('aria-label', 'Settings');
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.title = 'Settings';
      btn.dataset.testid = 'settings-toggle';
      btn.innerHTML = GEAR;
      btn.addEventListener('click', open);
      s.after(btn);
    }
  }
  refresh();
  const timer = win.setInterval(refresh, 1500);

  return {
    open,
    get: () => ({ ...state }),
    destroy() {
      win.clearInterval(timer);
      dialog.remove();
      for (const b of doc.querySelectorAll('.settings-toggle')) b.remove();
    },
  };
}
