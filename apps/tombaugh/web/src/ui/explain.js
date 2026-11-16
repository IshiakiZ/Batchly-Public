// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

/**
 * Small "?" buttons on the parts of the page. Pressing one opens a short note that says, in
 * everyday words, what that part is and what to do with it. One note is open at a time; a press
 * anywhere else, or Escape, closes it.
 *
 * Each entry: { id, title, text, find(doc) -> element | null, inside?, modes? }.
 * `inside` keeps the button within a part that clips its edges (the picture).
 */
export const EXPLAIN = [
  {
    id: 'views',
    title: 'Three ways to look',
    text: 'Photos shows each visit as it was taken. What changed lights up anything that got brighter, dimmer or moved. In colour blends the camera’s colours into one picture.',
    modes: ['simple'],
    find: (doc) => doc.querySelector('#simplebar'),
  },
  {
    id: 'picture',
    title: 'The picture',
    text: 'A real photo of this patch of sky from NASA’s SPHEREx telescope. Each square is one camera pixel. Click a star to check it.',
    modes: ['simple'],
    inside: true,
    find: (doc) => doc.querySelector('#viewer-frame'),
  },
  {
    id: 'player',
    title: 'Flip through the visits',
    text: 'SPHEREx comes back to the same spot about every six months. Play flips between the visits, the way Clyde Tombaugh found Pluto. Whatever jumps has moved or changed.',
    find: (doc) => doc.querySelector('#player'),
  },
  {
    id: 'tools',
    title: 'Picture tools',
    text: 'Wider and Closer change how much sky you see. Smooth softens the squares. Known stars circles the stars already in the catalogue. Save keeps the picture.',
    modes: ['simple'],
    find: (doc) => doc.querySelector('#simpletools'),
  },
  {
    id: 'place',
    title: 'This place',
    text: 'The star or spot you picked, and what it is known for. Open “About this place” to read more.',
    modes: ['simple'],
    find: (doc) => doc.querySelector('.simple-field'),
  },
  {
    id: 'changes',
    title: 'What changed',
    text: 'Every spot where the photos disagree, checked one by one. Press an entry to jump to it and see what it did.',
    modes: ['simple'],
    find: (doc) => card(doc.querySelector('.simple-changes')),
  },
  {
    id: 'check',
    title: 'Check a star',
    text: 'Click any star in the picture. You get how fast it moves across the sky, how much its brightness changed, and its colours.',
    modes: ['simple'],
    find: (doc) => card(doc.querySelector('.simple-card-head')),
  },
  {
    id: 'panels',
    title: 'The measurements',
    text: 'Each tab is one measurement of the spot you clicked: its colours (Spectrum), its brightness over time (Light curve), how it moves (Motion), and what the catalogues call it.',
    modes: ['advanced'],
    find: (doc) => doc.querySelector('#panels'),
  },
  {
    id: 'sky',
    title: 'The whole sky',
    text: 'Drag to look around. Scroll or pinch to zoom in. Click any star to see it through SPHEREx, type a name in the box, or pick one of the places along the bottom.',
    host: 'sky',
    find: (doc) => doc.querySelector('.skyhome-actions'),
  },
];

function card(el) {
  return el && el.closest ? el.closest('.simple-card') : null;
}

/** Where the note goes: under the button and inside the window, or above it when there is no room. Pure. */
export function placeNote(btn, size, view, gap = 8) {
  const left = Math.min(Math.max(gap, btn.right - size.width), Math.max(gap, view.width - size.width - gap));
  const below = btn.bottom + gap;
  const top = below + size.height + gap <= view.height ? below : Math.max(gap, btn.top - gap - size.height);
  return { left: Math.round(left), top: Math.round(top) };
}

/** createExplain({ win, doc, entries }) -> { refresh(), close(), destroy() } */
export function createExplain({ win = typeof window !== 'undefined' ? window : null, doc = typeof document !== 'undefined' ? document : null, entries = EXPLAIN } = {}) {
  if (!win || !doc) return { refresh() {}, close() {}, destroy() {} };
  const made = new Map(); // entry id -> its button
  let note = null;
  let openBtn = null;

  function close() {
    if (note) note.remove();
    note = null;
    if (openBtn) openBtn.setAttribute('aria-expanded', 'false');
    openBtn = null;
  }

  function open(entry, btn) {
    close();
    note = doc.createElement('div');
    note.className = 'explain-pop';
    note.setAttribute('role', 'note');
    const title = doc.createElement('b');
    title.textContent = entry.title;
    const text = doc.createElement('span');
    text.textContent = entry.text;
    note.append(title, text);
    doc.body.appendChild(note);
    const at = placeNote(btn.getBoundingClientRect(), { width: note.offsetWidth, height: note.offsetHeight }, { width: win.innerWidth, height: win.innerHeight });
    note.style.left = `${at.left}px`;
    note.style.top = `${at.top}px`;
    btn.setAttribute('aria-expanded', 'true');
    openBtn = btn;
  }

  function build(entry) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = entry.host === 'sky' ? 'skyhome-mode explain-btn explain-btn-sky' : `explain-btn${entry.inside ? ' is-inside' : ''}`;
    btn.textContent = '?';
    btn.setAttribute('aria-label', `What is this? ${entry.title}`);
    btn.setAttribute('aria-expanded', 'false');
    btn.dataset.explain = entry.id;
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (openBtn === btn) close();
      else open(entry, btn);
    });
    return btn;
  }

  function refresh() {
    const mode = doc.documentElement.dataset.mode || 'simple';
    for (const entry of entries) {
      let btn = made.get(entry.id);
      const want = !entry.modes || entry.modes.includes(mode);
      const host = want ? entry.find(doc) : null;
      if (!host) {
        if (btn && btn.isConnected) {
          if (openBtn === btn) close();
          btn.remove();
        }
        continue;
      }
      if (btn && btn.parentNode === host) continue;
      if (!btn) {
        btn = build(entry);
        made.set(entry.id, btn);
      }
      if (entry.host === 'sky') host.insertBefore(btn, host.firstChild);
      else {
        if (win.getComputedStyle(host).position === 'static') host.classList.add('explain-host');
        host.appendChild(btn);
      }
    }
  }

  const onDown = (ev) => {
    if (note && !(ev.target && ev.target.closest && ev.target.closest('.explain-pop, .explain-btn'))) close();
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') close();
  };
  doc.addEventListener('pointerdown', onDown, true);
  doc.addEventListener('keydown', onKey);
  win.addEventListener('resize', close);
  win.addEventListener('scroll', close, { passive: true, capture: true });
  // The page rebuilds its cards as results arrive: put back any button that went with them.
  const timer = win.setInterval(refresh, 1200);
  refresh();

  return {
    refresh,
    close,
    destroy() {
      win.clearInterval(timer);
      doc.removeEventListener('pointerdown', onDown, true);
      doc.removeEventListener('keydown', onKey);
      win.removeEventListener('resize', close);
      win.removeEventListener('scroll', close, { capture: true });
      close();
      for (const btn of made.values()) btn.remove();
      made.clear();
    },
  };
}
