// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHORTCUTS,
  bindShortcuts,
  normalizeBinding,
  keyFromEvent,
  bindingsForEvent,
  isTypingTarget,
  matchShortcut,
  formatKey,
} from './shortcuts.js';

function key(k, extra = {}) {
  return {
    key: k,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    defaultPrevented: false,
    target: { tagName: 'BODY' },
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...extra,
  };
}

function fakeTarget() {
  const listeners = new Set();
  return {
    addEventListener: (type, fn) => type === 'keydown' && listeners.add(fn),
    removeEventListener: (type, fn) => type === 'keydown' && listeners.delete(fn),
    dispatch(ev) {
      for (const fn of Array.from(listeners)) fn(ev);
      return ev;
    },
    get count() {
      return listeners.size;
    },
  };
}

test('normalizeBinding canonicalises keys, aliases and modifier order', () => {
  assert.equal(normalizeBinding('Space'), 'Space');
  assert.equal(normalizeBinding(' '), 'Space');
  assert.equal(normalizeBinding('space'), 'Space');
  assert.equal(normalizeBinding('?'), '?');
  assert.equal(normalizeBinding('B'), 'b');
  assert.equal(normalizeBinding('b'), 'b');
  assert.equal(normalizeBinding('3'), '3');
  assert.equal(normalizeBinding('ArrowLeft'), 'ArrowLeft');
  assert.equal(normalizeBinding('left'), 'ArrowLeft');
  assert.equal(normalizeBinding('arrowup'), 'ArrowUp');
  assert.equal(normalizeBinding('Esc'), 'Escape');
  assert.equal(normalizeBinding('shift+ArrowRight'), 'Shift+ArrowRight');
  assert.equal(normalizeBinding('Shift+Ctrl+K'), 'Ctrl+Shift+k');
  assert.equal(normalizeBinding('cmd+k'), 'Meta+k');
  assert.equal(normalizeBinding('Alt + g'), 'Alt+g');
  assert.equal(normalizeBinding('+'), '+');
  assert.equal(normalizeBinding('Shift++'), 'Shift++');
  assert.equal(normalizeBinding(''), null);
  assert.equal(normalizeBinding('Hyper+k'), null);
  assert.equal(normalizeBinding(null), null);
  assert.equal(normalizeBinding('Ctrl+'), null);
});

test('keyFromEvent reads KeyboardEvent.key', () => {
  assert.equal(keyFromEvent(key(' ')), 'Space');
  assert.equal(keyFromEvent(key('Spacebar')), 'Space');
  assert.equal(keyFromEvent(key('B')), 'b');
  assert.equal(keyFromEvent(key('?')), '?');
  assert.equal(keyFromEvent(key('ArrowDown')), 'ArrowDown');
  assert.equal(keyFromEvent(key('Esc')), 'Escape');
  assert.equal(keyFromEvent(key('5')), '5');
  assert.equal(keyFromEvent(key('Shift')), null);
  assert.equal(keyFromEvent(key('Dead')), null);
  assert.equal(keyFromEvent({}), null);
});

test('bindingsForEvent orders candidates and handles Shift', () => {
  assert.deepEqual(bindingsForEvent(key('b')), ['b']);
  assert.deepEqual(bindingsForEvent(key('B', { shiftKey: true })), ['Shift+b', 'b']);
  assert.deepEqual(bindingsForEvent(key('?', { shiftKey: true })), ['?', 'Shift+?']);
  assert.deepEqual(bindingsForEvent(key('ArrowRight', { shiftKey: true })), ['Shift+ArrowRight', 'ArrowRight']);
  assert.deepEqual(bindingsForEvent(key('r', { ctrlKey: true })), ['Ctrl+r']);
  assert.deepEqual(bindingsForEvent(key('k', { metaKey: true, shiftKey: true })), ['Shift+Meta+k', 'Meta+k']);
  assert.deepEqual(bindingsForEvent(key('Control', { ctrlKey: true })), []);
});

test('isTypingTarget recognises text entry', () => {
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isTypingTarget({ tagName: 'INPUT' }), true);
  assert.equal(isTypingTarget({ tagName: 'input', type: 'search' }), true);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'range' }), true, 'sliders use the arrow keys');
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', getAttribute: () => 'textbox' }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', getAttribute: () => 'button' }), false);
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isTypingTarget(null), false);
});

test('matchShortcut finds handlers for space, arrows, letters, digits and ?', () => {
  const map = { Space: () => 'play', ArrowLeft: () => 'back', ArrowRight: () => 'fwd', b: () => 'blink', 1: () => 'd1', 6: () => 'd6', '?': () => 'help' };
  const run = (ev) => {
    const hit = matchShortcut(map, ev);
    return hit ? hit.handler(ev, hit.binding) : null;
  };
  assert.equal(run(key(' ')), 'play');
  assert.equal(run(key('ArrowLeft')), 'back');
  assert.equal(run(key('ArrowRight')), 'fwd');
  assert.equal(run(key('b')), 'blink');
  assert.equal(run(key('B')), 'blink', 'caps lock');
  assert.equal(run(key('B', { shiftKey: true })), 'blink', 'shift falls back to the plain letter');
  assert.equal(run(key('1')), 'd1');
  assert.equal(run(key('6')), 'd6');
  assert.equal(run(key('7')), null);
  assert.equal(run(key('?', { shiftKey: true })), 'help');
  assert.equal(run(key('x')), null);
});

test('matchShortcut ignores typing, browser chords, composition and handled events', () => {
  const map = { b: () => 'blink', r: () => 'residual', Space: () => 'play', ArrowLeft: () => 'back' };
  assert.equal(matchShortcut(map, key('b', { target: { tagName: 'INPUT', type: 'text' } })), null);
  assert.equal(matchShortcut(map, key(' ', { target: { tagName: 'TEXTAREA' } })), null);
  assert.equal(matchShortcut(map, key('ArrowLeft', { target: { tagName: 'INPUT', type: 'range' } })), null);
  assert.equal(matchShortcut(map, key('b', { target: { tagName: 'DIV', isContentEditable: true } })), null);
  assert.equal(matchShortcut(map, key('r', { ctrlKey: true })), null, 'Ctrl+R stays a reload');
  assert.equal(matchShortcut(map, key('r', { metaKey: true })), null);
  assert.equal(matchShortcut(map, key('b', { altKey: true })), null);
  assert.equal(matchShortcut(map, key('b', { isComposing: true })), null);
  assert.equal(matchShortcut(map, key('b', { defaultPrevented: true })), null);
  // Space on a focused button presses the button, it does not play the movie.
  assert.equal(matchShortcut(map, key(' ', { target: { tagName: 'BUTTON' } })), null);
  assert.equal(matchShortcut(map, key(' ', { target: { tagName: 'A' } })), null);
  assert.equal(matchShortcut(map, key(' ', { target: { tagName: 'DIV', getAttribute: () => 'button' } })), null);
  // Letters still work with a button focused.
  assert.ok(matchShortcut(map, key('b', { target: { tagName: 'BUTTON' } })));
  assert.ok(matchShortcut(map, key('ArrowLeft', { target: { tagName: 'BUTTON' } })));
});

test('modifier bindings are exact and take priority', () => {
  const log = [];
  const map = { ArrowRight: () => log.push('step'), 'Shift+ArrowRight': () => log.push('jump'), 'ctrl+k': () => log.push('palette') };
  const run = (ev) => {
    const hit = matchShortcut(map, ev);
    if (hit) hit.handler(ev, hit.binding);
    return hit && hit.binding;
  };
  assert.equal(run(key('ArrowRight')), 'ArrowRight');
  assert.equal(run(key('ArrowRight', { shiftKey: true })), 'Shift+ArrowRight');
  assert.equal(run(key('k', { ctrlKey: true })), 'Ctrl+k');
  assert.equal(run(key('k')), null);
  assert.deepEqual(log, ['step', 'jump', 'palette']);
});

test('bindShortcuts dispatches, prevents default, honours return false, enabled and unbind', () => {
  const target = fakeTarget();
  const log = [];
  let enabled = true;
  const unbind = bindShortcuts(
    {
      Space: (ev, binding) => log.push(binding),
      g: () => {
        log.push('g');
        return false;
      },
      'not a + binding': () => log.push('never'),
      f: 'not a function',
    },
    { target, enabled: () => enabled },
  );
  assert.equal(target.count, 1);
  const a = target.dispatch(key(' '));
  assert.deepEqual(log, ['Space']);
  assert.equal(a.defaultPrevented, true, 'space must not scroll the page');
  const b = target.dispatch(key('g'));
  assert.equal(b.defaultPrevented, false, 'handler returned false');
  const c = target.dispatch(key('f'));
  assert.equal(c.defaultPrevented, false);
  const d = target.dispatch(key(' ', { target: { tagName: 'INPUT', type: 'text' } }));
  assert.equal(d.defaultPrevented, false, 'typing a space in the search box is left alone');
  enabled = false;
  target.dispatch(key(' '));
  assert.deepEqual(log, ['Space', 'g']);
  enabled = true;
  unbind();
  assert.equal(target.count, 0);
  target.dispatch(key(' '));
  assert.deepEqual(log, ['Space', 'g']);
});

test('bindShortcuts is a no-op without a DOM', () => {
  const unbind = bindShortcuts({ b: () => {} }, { target: null });
  assert.equal(typeof unbind, 'function');
  unbind();
});

test('SHORTCUTS covers the contract list with valid, unique bindings', () => {
  const ids = SHORTCUTS.map((s) => s.id);
  for (const id of ['play', 'step', 'blink', 'residual', 'gaia', 'flags', 'detector', 'help']) assert.ok(ids.includes(id), id);
  const byId = Object.fromEntries(SHORTCUTS.map((s) => [s.id, s]));
  assert.deepEqual(byId.play.keys, ['Space']);
  assert.deepEqual(byId.step.keys, ['ArrowLeft', 'ArrowRight']);
  assert.deepEqual(byId.blink.keys, ['b']);
  assert.deepEqual(byId.residual.keys, ['r']);
  assert.deepEqual(byId.gaia.keys, ['g']);
  assert.deepEqual(byId.flags.keys, ['f']);
  assert.deepEqual(byId.detector.keys, ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(byId.help.keys, ['?']);
  const seen = new Set();
  for (const s of SHORTCUTS) {
    assert.ok(s.label && !/!/.test(s.label), 'has a calm label');
    for (const k of s.keys) {
      assert.equal(normalizeBinding(k), k, `${k} is already canonical`);
      assert.ok(!seen.has(k), `${k} bound once`);
      seen.add(k);
    }
  }
});

test('formatKey gives short display text', () => {
  assert.equal(formatKey('ArrowLeft'), '←');
  assert.equal(formatKey('ArrowRight'), '→');
  assert.equal(formatKey('b'), 'B');
  assert.equal(formatKey('Space'), 'Space');
  assert.equal(formatKey('Escape'), 'Esc');
  assert.equal(formatKey('?'), '?');
  assert.equal(formatKey('shift+left'), 'Shift + ←');
  assert.equal(formatKey('Shift++'), 'Shift + +');
});
