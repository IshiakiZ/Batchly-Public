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

  const list = doc.createElement('div');
  list.className = 'picklist';
  list.id = id;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Stars to pick from');
  list.hidden = true;
  (opts.host || input.parentNode).append(list);

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
      row.addEventListener('pointerdown', (ev) => ev.preventDefault()); // keep the caret in the box
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
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function choose(item) {
    input.value = item.name;
    close();
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
    if (list.contains(ev.relatedTarget)) return;
    close();
  };
  const onOutside = (ev) => {
    if (isOpen && ev.target !== input && !list.contains(ev.target)) close();
  };

  input.addEventListener('focus', onFocus);
  input.addEventListener('click', onFocus);
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKey, true);
  input.addEventListener('blur', onBlur);
  doc.addEventListener('pointerdown', onOutside);

  return {
    el: list,
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
      list.remove();
    },
  };
}
