// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// shortcuts.js: keyboard shortcuts and the help overlay that lists them.
//
// Contract surface:
//   bindShortcuts(map) -> unbind
//   SHORTCUTS            metadata for the help overlay
//
// bindShortcuts(map, opts?)
//   map: { '<binding>': (event, binding) => any }. Bindings: 'Space', '?', 'ArrowLeft', 'ArrowRight',
//   'ArrowUp', 'ArrowDown', 'Escape', 'Enter', single letters ('b'), digits ('1'), optionally with
//   modifiers in any order: 'Shift+ArrowRight', 'Ctrl+k', 'Alt+g', 'Meta+k'. Letters are
//   case-insensitive. The matched key's default action is prevented unless the handler returns false.
//   Keystrokes are ignored while the user types in an input, textarea, select or editable element,
//   and Space / Enter are left alone on buttons and links so they keep activating the control.
//   Shift is forgiving: Shift+b runs 'b' when no 'Shift+b' binding exists. Ctrl, Alt and Meta
//   never fall back, so browser shortcuts such as Ctrl+R are not hijacked by 'r'.
//
// Optional extras (not in the contract):
//   opts.target            element or document to listen on (default document)
//   opts.enabled           () => boolean, checked on every key
//   normalizeBinding(text), keyFromEvent(event), bindingsForEvent(event), isTypingTarget(el),
//   matchShortcut(map, event), formatKey(key)     exported for tests and for custom UIs
//   createShortcutHelp(container, { shortcuts? }) -> { show(), hide(), toggle(), isOpen(), destroy() }

import { onEscape } from './fx.js';
import { injectStyles } from './experience.css.js';

/** Shortcut metadata, in the order the help overlay lists them. */
export const SHORTCUTS = Object.freeze([
  { id: 'play', keys: ['Space'], label: 'Play or pause the movie' },
  { id: 'step', keys: ['ArrowLeft', 'ArrowRight'], label: 'Step one frame back or forward' },
  { id: 'blink', keys: ['b'], label: 'Blink between frame A and frame B' },
  { id: 'residual', keys: ['r'], label: 'Residual view: subtract the predicted sky' },
  { id: 'gaia', keys: ['g'], label: 'Gaia ghost rings on or off' },
  { id: 'flags', keys: ['f'], label: 'Flagged pixels on or off' },
  { id: 'detector', keys: ['1', '2', '3', '4', '5', '6'], display: ['1', '6'], range: true, label: 'Choose a detector, 1 (0.75 \u00b5m) to 6 (5.0 \u00b5m)' },
  { id: 'help', keys: ['?'], label: 'Show this list' },
  { id: 'close', keys: ['Escape'], label: 'Close a card or this list' },
]);

const KEY_ALIASES = {
  ' ': 'Space',
  space: 'Space',
  spacebar: 'Space',
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  tab: 'Tab',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  backspace: 'Backspace',
  delete: 'Delete',
  plus: '+',
};

const MOD_ALIASES = { ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift', meta: 'Meta', cmd: 'Meta', command: 'Meta' };
const MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];

function normalizeKeyName(name) {
  if (name === ' ') return 'Space';
  const raw = String(name);
  const alias = KEY_ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  if (raw.length === 1) return raw.toLowerCase();
  return raw;
}

/**
 * Canonical form of a binding string: modifiers in the order Ctrl, Alt, Shift, Meta, then the key.
 * Returns null for an empty or malformed binding.
 */
export function normalizeBinding(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  if (text === '+' || text === ' ') return normalizeKeyName(text);
  // Split on '+', keeping a trailing '+' as the key itself ("Shift++").
  let parts = text.split('+');
  if (text.endsWith('++')) parts = parts.slice(0, -2).concat('+');
  const keyPart = parts.pop();
  if (keyPart === undefined || keyPart === '') return null;
  const mods = new Set();
  for (const p of parts) {
    const m = MOD_ALIASES[p.trim().toLowerCase()];
    if (!m) return null;
    mods.add(m);
  }
  const key = normalizeKeyName(keyPart === ' ' ? ' ' : keyPart.trim());
  if (!key) return null;
  return MOD_ORDER.filter((m) => mods.has(m)).concat(key).join('+');
}

/** The key of a KeyboardEvent in canonical form, without modifiers ('Space', 'b', '?', 'ArrowLeft'). */
export function keyFromEvent(event) {
  const k = event && event.key;
  if (typeof k !== 'string' || k.length === 0) return null;
  if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'Dead' || k === 'Unidentified') return null;
  return normalizeKeyName(k);
}

/**
 * The bindings an event can satisfy, most specific first.
 * 'Shift+b' is tried before 'b'; a shifted symbol such as '?' is tried bare first.
 */
export function bindingsForEvent(event) {
  const key = keyFromEvent(event);
  if (!key) return [];
  const hard = [];
  if (event.ctrlKey) hard.push('Ctrl');
  if (event.altKey) hard.push('Alt');
  const meta = event.metaKey ? ['Meta'] : [];
  const withShift = hard.concat(event.shiftKey ? ['Shift'] : [], meta, key).join('+');
  const noShift = hard.concat(meta, key).join('+');
  if (!event.shiftKey) return [noShift];
  const isSymbol = key.length === 1 && !/[a-z0-9]/.test(key);
  return isSymbol ? [noShift, withShift] : [withShift, noShift];
}

const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider', 'listbox']);
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'color']);
const ACTIVATING_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'switch', 'option']);

/** True when keystrokes on this element are text entry (or drive a native widget). */
export function isTypingTarget(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has(String(el.type || 'text').toLowerCase());
  if (el.isContentEditable) return true;
  const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
  return !!role && TEXT_ROLES.has(role);
}

/** True when Space or Enter on this element already means "activate it". */
function activatesOnKey(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'A' || tag === 'INPUT') return true;
  const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
  return !!role && ACTIVATING_ROLES.has(role);
}

function normalizeMap(map) {
  const out = new Map();
  for (const [binding, handler] of Object.entries(map || {})) {
    const norm = normalizeBinding(binding);
    if (norm && typeof handler === 'function') out.set(norm, handler);
  }
  return out;
}

/**
 * Find the handler for a keyboard event, or null. `map` may be a plain object or the Map made
 * by an earlier call. Applies the typing and activation guards.
 * @returns {{ binding: string, handler: Function } | null}
 */
export function matchShortcut(map, event) {
  if (!event || event.defaultPrevented || event.isComposing) return null;
  const table = map instanceof Map ? map : normalizeMap(map);
  const target = event.target;
  if (isTypingTarget(target)) return null;
  const key = keyFromEvent(event);
  if (!key) return null;
  if ((key === 'Space' || key === 'Enter') && activatesOnKey(target)) return null;
  for (const binding of bindingsForEvent(event)) {
    const handler = table.get(binding);
    if (handler) return { binding, handler };
  }
  return null;
}

/**
 * Bind keyboard shortcuts. Returns a function that removes them.
 * @param {Object<string, (event: KeyboardEvent, binding: string) => any>} map
 * @param {{ target?: EventTarget, enabled?: () => boolean }} [opts]
 */
export function bindShortcuts(map, opts = {}) {
  const table = normalizeMap(map);
  const target = opts.target || globalThis.document;
  if (!target || !target.addEventListener) return () => {};
  const onKey = (event) => {
    if (opts.enabled && !opts.enabled()) return;
    const hit = matchShortcut(table, event);
    if (!hit) return;
    const result = hit.handler(event, hit.binding);
    if (result !== false) event.preventDefault();
  };
  target.addEventListener('keydown', onKey);
  return function unbind() {
    target.removeEventListener('keydown', onKey);
  };
}

const KEY_LABELS = {
  Space: 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
};

/** Short display text for a key: 'ArrowLeft' -> '←', 'b' -> 'B'. */
export function formatKey(key) {
  const norm = normalizeBinding(key) || String(key);
  return norm
    .split(/\+(?!$)/)
    .map((part) => KEY_LABELS[part] || (part.length === 1 ? part.toUpperCase() : part))
    .join(' + ');
}

/**
 * The help overlay: a small dialog listing the shortcuts.
 * @param {Element} container where the overlay element is appended
 * @param {{ shortcuts?: Array }} [opts]
 * @returns {{ show(): void, hide(): void, toggle(): void, isOpen(): boolean, destroy(): void }}
 */
export function createShortcutHelp(container, opts = {}) {
  const doc = container.ownerDocument || globalThis.document;
  injectStyles(doc);
  const list = opts.shortcuts || SHORTCUTS;

  const root = doc.createElement('div');
  root.className = 'tbx tbx-help';
  root.hidden = true;

  const backdrop = doc.createElement('div');
  backdrop.className = 'tbx-help__backdrop';
  root.appendChild(backdrop);

  const panel = doc.createElement('div');
  panel.className = 'tbx-help__panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Keyboard shortcuts');
  panel.tabIndex = -1;
  root.appendChild(panel);

  const head = doc.createElement('div');
  head.className = 'tbx-help__head';
  const title = doc.createElement('h2');
  title.className = 'tbx-help__title';
  title.textContent = 'Keyboard';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'tbx-iconbtn';
  close.setAttribute('aria-label', 'Close keyboard shortcuts');
  close.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>';
  head.append(title, close);
  panel.appendChild(head);

  const dl = doc.createElement('dl');
  dl.className = 'tbx-help__list';
  for (const item of list) {
    const dt = doc.createElement('dt');
    const shown = item.display || item.keys;
    shown.forEach((key, i) => {
      if (i > 0) {
        const sep = doc.createElement('span');
        sep.className = 'tbx-help__sep';
        sep.textContent = item.range ? 'to' : '';
        sep.setAttribute('aria-hidden', item.range ? 'false' : 'true');
        dt.appendChild(sep);
      }
      const kbd = doc.createElement('kbd');
      kbd.className = 'tbx-kbd';
      kbd.textContent = formatKey(key);
      dt.appendChild(kbd);
    });
    const dd = doc.createElement('dd');
    dd.textContent = item.label;
    dl.append(dt, dd);
  }
  panel.appendChild(dl);

  const note = doc.createElement('p');
  note.className = 'tbx-help__note';
  note.textContent = 'Shortcuts pause while you type in a box.';
  panel.appendChild(note);

  container.appendChild(root);

  let open = false;
  let opener = null;
  let releaseEscape = null;
  let hideTimer = null;

  const trapTab = (ev) => {
    if (ev.key !== 'Tab') return;
    // The dialog has one focusable control; keep focus on it.
    ev.preventDefault();
    close.focus();
  };

  function show() {
    if (open) return;
    open = true;
    clearTimeout(hideTimer);
    opener = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
    root.hidden = false;
    void root.offsetWidth; // commit the starting state so the transition runs
    root.classList.add('is-open');
    releaseEscape = onEscape(hide, doc);
    panel.addEventListener('keydown', trapTab);
    close.focus({ preventScroll: true });
  }

  function hide() {
    if (!open) return;
    open = false;
    root.classList.remove('is-open');
    if (releaseEscape) releaseEscape();
    releaseEscape = null;
    panel.removeEventListener('keydown', trapTab);
    hideTimer = setTimeout(() => {
      if (!open) root.hidden = true;
    }, 180);
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    opener = null;
  }

  close.addEventListener('click', hide);
  backdrop.addEventListener('click', hide);

  return {
    show,
    hide,
    toggle: () => (open ? hide() : show()),
    isOpen: () => open,
    destroy() {
      hide();
      clearTimeout(hideTimer);
      root.remove();
    },
  };
}
