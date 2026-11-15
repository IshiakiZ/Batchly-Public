// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// The target tour: the challenge targets as one-click chips with the reason each is worth a look.

/**
 * Used only when core/targets.js is unavailable, so the page still has something to click.
 * Positions are catalogue values with proper motion; the shell propagates them to today.
 */
export const FALLBACK_TARGETS = Object.freeze([
  {
    id: 'barnard',
    name: "Barnard's Star",
    blurb: 'The star with the largest proper motion',
    ra: 269.452083,
    dec: 4.693391,
    epoch: 2000.0,
    pmra: -802.8,
    pmdec: 10362.5,
    parallax: 547.0,
    det: 3,
    fov: 4,
    why: 'Moves 10.4 arcsec a year: about 5.2 arcsec per six-month pass, 0.85 of a 6.15 arcsec SPHEREx pixel (1.7 pixels of the 3.075 arcsec display grid).',
  },
  {
    id: 'wise0855',
    name: 'WISE 0855-0714',
    blurb: 'A brown dwarf at about 250 K',
    ra: 133.795129,
    dec: -7.245147,
    epoch: 2014.3,
    pmra: -8118,
    pmdec: 680,
    parallax: 439.0,
    det: 6,
    fov: 4,
    why: 'About 250 K and 2.3 parsecs away; in SPHEREx it only shows up near 5 micrometres.',
  },
]);

/** Find a target by id or (case-insensitive, punctuation-insensitive) name. */
export function findTarget(targets, text) {
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const q = norm(text);
  if (!q) return null;
  return (targets || []).find((t) => norm(t.id) === q || norm(t.name) === q) || null;
}

/**
 * createTour(container, { targets, onPick(target), variant }) -> { setTargets(list), destroy() }
 * variant: 'chips' (name + reason), 'compact' (name only, reason as tooltip), 'cards'.
 */
export function createTour(container, { targets = [], onPick = () => {}, variant = 'chips', limit = 0 } = {}) {
  const doc = container.ownerDocument;
  container.classList.add('chips');
  if (variant === 'compact') container.classList.add('is-compact');
  if (variant === 'cards') container.classList.add('is-cards');
  container.setAttribute('role', 'list');

  function setTargets(list) {
    container.textContent = '';
    const shown = limit > 0 ? list.slice(0, limit) : list;
    for (const target of shown) {
      const item = doc.createElement('div');
      item.setAttribute('role', 'listitem');
      const chip = doc.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.target = target.id;
      const name = doc.createElement('span');
      name.className = 'chip-name';
      name.textContent = target.name;
      chip.append(name);
      const why = target.why || target.blurb || '';
      if (why) {
        const reason = doc.createElement('span');
        reason.className = 'chip-why';
        reason.textContent = why;
        chip.append(reason);
        chip.title = why;
        if (variant === 'compact') chip.setAttribute('aria-label', `${target.name}. ${why}`);
      }
      chip.addEventListener('click', () => onPick(target));
      item.append(chip);
      container.append(item);
    }
  }

  setTargets(targets);
  return {
    setTargets,
    destroy() {
      container.textContent = '';
    },
  };
}
