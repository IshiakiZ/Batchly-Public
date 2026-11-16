// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// picklist.js: a scrollable list of names under a search box, so nobody has to spell a star's
// name. Click the box to see every name; type to narrow the list; click one (or arrow keys and
// Enter) to pick it.
//
//   attachPickList(input, { items, onPick, enabled }) -> { el, open(), close(), destroy() }
//     items    [{ name, group? }] or a function returning them. Items with a group are listed
//              first under that heading; the rest follow in the order given.
//     onPick   (item) => void
//     enabled  () => boolean, checked each time the list would open (default: always)

/** The items whose name contains `text`, names that start with it first. Pure. */
export function filterPicks(items, text) {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return items.slice();
  const fold = (s) => String(s).toLowerCase();
  const starts = [];
  const words = [];
  const inside = [];
  for (const item of items) {
    const name = fold(item.name);
    if (name.startsWith(q)) starts.push(item);
    else if (name.includes(` ${q}`)) words.push(item);
    else if (name.includes(q)) inside.push(item);
  }
  return [...starts, ...words, ...inside];
}

/** The item whose name is exactly `text` (ignoring case and outer spaces), or null. Pure. */
export function exactPick(items, text) {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return null;
  return items.find((item) => String(item.name).toLowerCase() === q) || null;
}

let uid = 0;

export function attachPickList(input, opts = {}) {
  const doc = input.ownerDocument;
  const getItems = () => (typeof opts.items === 'function' ? opts.items() : opts.items) || [];
  const enabled = () => (typeof opts.enabled === 'function' ? !!opts.enabled() : true);
  const id = `picklist-${++uid}`;

  // The glass panel stays still and the list scrolls inside it (glass layers must not scroll away).
  const pop = doc.createElement('div');
  pop.className = 'picklist';
  pop.hidden = true;
  const list = doc.createElement('div');
  list.className = 'picklist-scroll';
  list.id = id;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Stars to pick from');
  pop.append(list);
  (opts.host || input.parentNode).append(pop);

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', id);
  input.setAttribute('aria-expanded', 'false');

  let shown = [];
  let active = -1;
  let isOpen = false;

  function setActive(index, scroll = true) {
    const rows = list.querySelectorAll('.picklist-row');
    if (rows[active]) rows[active].classList.remove('is-active');
    active = index;
    const row = rows[active];
    if (row) {
      row.classList.add('is-active');
      input.setAttribute('aria-activedescendant', row.id);
      if (scroll && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  // Until something is typed the whole list shows, even when the box already holds a name.
  let typed = false;

  function render() {
    const items = getItems();
    shown = filterPicks(items, typed ? input.value : '');
    list.textContent = '';
    active = -1;
    input.removeAttribute('aria-activedescendant');
    if (!shown.length) {
      const none = doc.createElement('p');
      none.className = 'picklist-none';
      none.textContent = 'No star by that name. Press Enter to search anyway.';
      list.append(none);
      return;
    }
    const filtering = typed && input.value.trim() !== '';
    let lastGroup = null;
    shown.forEach((item, index) => {
      const group = filtering ? '' : item.group || 'All stars';
      if (!filtering && group !== lastGroup) {
        const head = doc.createElement('p');
        head.className = 'picklist-head';
        head.textContent = group;
        list.append(head);
        lastGroup = group;
      }
      const row = doc.createElement('div');
      row.className = 'picklist-row';
      row.id = `${id}-${index}`;
      row.setAttribute('role', 'option');
      row.textContent = item.name;
      if (item.group) row.classList.add('is-featured');
      // Keep the caret in the box. On an iPhone the box still loses focus when a name is
      // touched, so the press is remembered and the list is not closed under the finger.
      row.addEventListener('pointerdown', (ev) => {
        press();
        ev.preventDefault();
      });
      row.addEventListener('touchstart', press, { passive: true });
      row.addEventListener('mousedown', (ev) => ev.preventDefault());
      row.addEventListener('click', () => choose(item));
      list.append(row);
    });
    list.scrollTop = 0;
  }

  function open() {
    if (!enabled()) return;
    render();
    if (isOpen) return;
    isOpen = true;
    pop.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    pop.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  // A name is being pressed: for a moment, losing focus must not close the list.
  let pressing = 0;
  function press() {
    pressing = Date.now() + 700;
  }

  function choose(item) {
    pressing = 0;
    input.value = item.name;
    close();
    // On a touch screen the keyboard would cover what the pick shows, so it is put away.
    const view = doc.defaultView;
    if (view && typeof view.matchMedia === 'function' && view.matchMedia('(pointer: coarse)').matches && typeof input.blur === 'function') input.blur();
    if (typeof opts.onPick === 'function') opts.onPick(item);
  }

  const onFocus = () => {
    if (!isOpen) {
      typed = false;
      if (enabled() && input.value && typeof input.select === 'function') input.select();
    }
    open();
  };
  const onInput = () => {
    typed = true;
    open();
  };
  const onKey = (ev) => {
    if (!enabled()) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!isOpen) {
        open();
        return;
      }
      if (!shown.length) return;
      const step = ev.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + shown.length) % shown.length);
      return;
    }
    if (ev.key === 'Enter') {
      const item = isOpen && active >= 0 ? shown[active] : exactPick(getItems(), input.value);
      if (item) {
        ev.preventDefault();
        ev.stopPropagation();
        choose(item);
      } else close();
      return;
    }
    if (ev.key === 'Escape' && isOpen) {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  };
  const onBlur = (ev) => {
    if (pop.contains(ev.relatedTarget)) return;
    if (Date.now() < pressing) return;
    close();
  };
  const onOutside = (ev) => {
    if (isOpen && ev.target !== input && !pop.contains(ev.target)) close();
  };

  input.addEventListener('focus', onFocus);
  input.addEventListener('click', onFocus);
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKey, true);
  input.addEventListener('blur', onBlur);
  doc.addEventListener('pointerdown', onOutside);

  return {
    el: pop,
    open,
    close,
    isOpen: () => isOpen,
    destroy() {
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('click', onFocus);
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKey, true);
      input.removeEventListener('blur', onBlur);
      doc.removeEventListener('pointerdown', onOutside);
      pop.remove();
    },
  };
}
