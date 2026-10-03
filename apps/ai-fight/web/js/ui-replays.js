// ─────────────────────────────────────────────────────────────────────────────
//  REPLAYS tab: every round of this match, earlier matches (from the history),
//  the exhibition launcher and this session's exhibitions.
// ─────────────────────────────────────────────────────────────────────────────
import { $, h, clear, add, num, dateTime, clockTime } from './util.js';
import { spriteImg } from './sprites.js';

/** The exhibition picker form (used by the Replays tab and the X modal). */
export function exhibitionForm(api, { onStarted, onCancel, compact = false } = {}) {
  const store = api.store;
  const cfg = store.config.fighters;
  const options = [
    ...cfg.map(f => ({ value: `ai:${f.id}`, text: `${f.label}'s current fighter` })),
    ...store.bots.filter(b => b.id !== 'dummy').map(b => ({ value: `bot:${b.id}`, text: `Bot: ${String(b.desc || b.id).split(' — ')[0]}` })),
  ];
  const sel = (def, label) => {
    const s = h('select', { 'aria-label': label }, options.map(o => h('option', { value: o.value }, o.text)));
    s.value = options.some(o => o.value === def) ? def : options[0].value;
    return s;
  };
  const a = sel('bot:ninja', 'Left corner'), b = sel('bot:paladin', 'Right corner');
  if (b.value === a.value && options.length > 1) b.value = options[1].value;
  const lvl = h('select', { 'aria-label': 'Level' }, [1, 2, 3, 4].map(l => h('option', { value: String(l) }, `Level ${l}`)));
  lvl.value = String(Math.min(4, store.state.level || 4));
  const go = h('button', { class: 'btn primary', type: 'button' }, '⚔ Fight!');
  const random = () => {
    const pool = options.map(o => o.value);
    const x = pool[Math.floor(Math.random() * pool.length)];
    let y = x;
    while (y === x && pool.length > 1) y = pool[Math.floor(Math.random() * pool.length)];
    a.value = x; b.value = y;
  };
  go.addEventListener('click', async () => {
    go.disabled = true;
    go.textContent = 'Simulating…';
    const labelOf = (s) => (options.find(o => o.value === s.value) || {}).text || s.value;
    const res = await api.startExhibition(a.value, b.value, Number(lvl.value), `${labelOf(a)} vs ${labelOf(b)}`);
    go.disabled = false;
    go.textContent = '⚔ Fight!';
    if (res && onStarted) onStarted(res);
  });
  return h('div', { class: `exh-form${compact ? ' compact' : ''}` },
    h('div', { class: 'exh-grid' },
      h('label', null, h('span', null, 'Left corner'), a),
      h('div', { class: 'exh-vs', 'aria-hidden': 'true' }, 'VS'),
      h('label', null, h('span', null, 'Right corner'), b)),
    h('div', { class: 'row-actions' },
      h('label', { class: 'set-row' }, h('span', null, 'Level'), lvl),
      h('span', { class: 'sp' }),
      h('button', { class: 'btn ghost', type: 'button', onclick: random }, '🎲 Random'),
      onCancel ? h('button', { class: 'btn ghost', type: 'button', onclick: onCancel }, 'Cancel') : null,
      go));
}

export class ReplaysScreen {
  constructor(api) {
    this.api = api;
    this.root = $('#replays');
    this.history = null;
    this.matchCache = {};
    this.expanded = new Set();
    this.dirty = true;
  }
  get store() { return this.api.store; }

  invalidate() { this.dirty = true; }
  refresh() { if (this.dirty) this.render(); }
  tick() { if (this.dirty) this.render(); }

  enter(opts) {
    if (opts && opts.match) { this.expanded.add(opts.match); this.loadMatch(opts.match); }
    this.render();
    this.loadHistory();
  }

  async loadHistory() {
    try {
      const r = await fetch('/api/history');
      if (r.ok) { this.history = await r.json(); this.dirty = true; }
    } catch { /* ignore */ }
  }

  async loadMatch(id) {
    if (this.matchCache[id]) return;
    this.matchCache[id] = 'loading';
    try {
      const r = await fetch(`/api/match/${encodeURIComponent(id)}`);
      this.matchCache[id] = r.ok ? await r.json() : 'missing';
    } catch { this.matchCache[id] = 'missing'; }
    this.dirty = true;
  }

  render() {
    this.dirty = false;
    const root = clear(this.root);
    const st = this.store.state;
    const match = this.store.match || { rounds: [] };
    const cfg = this.store.config.fighters;
    const rounds = (match.rounds || []).slice().reverse();
    const exh = this.api.exhibitions();
    const other = (match.mode && match.mode !== 'fighter') || (st.mode && st.mode !== 'fighter');   // army, business…: no exhibitions
    add(root,
      h('div', { class: 'page-head' },
        h('div', { class: 'ph-title' }, h('h1', null, 'Replays'), h('div', { class: 'sub' }, other ? 'Watch any round again' : 'Watch any round again, or pit any two fighters against each other for fun')),
        h('span', { class: 'sp' }),
        rounds.length ? h('button', { class: 'btn', onclick: () => this.api.openReplay(match.matchId, rounds[0].round) }, '▶ Last round', h('kbd', null, 'R')) : null),
      h('div', { class: 'rp-grid' },
        h('div', { class: 'rp-col' },
          h('section', { class: 'pbox st-card' },
            h('h2', null, `This match · Match ${match.matchNumber || st.matchNumber}`),
            rounds.length ? h('div', { class: 'rcards' }, rounds.map(r => this.roundCard(match.matchId, r, cfg)))
              : h('div', { class: 'empty-note' }, 'No rounds fought yet. Every round shows up here after its fight.')),
          this.pastMatches(cfg, match.matchId)),
        h('div', { class: 'rp-col side' },
          h('section', { class: 'pbox st-card' },
            h('h2', null, '🎮 Exhibition match'),
            other ? h('div', { class: 'empty-note' }, 'Exhibitions pit fighters against each other, so they are available in Fighter Duel matches only.')
              : [h('div', { class: 'cap' }, 'Any two fighters — sparring bots or the AIs’ current fighters. It doesn’t count for the score and the AIs never see it.'),
                exhibitionForm(this.api, { compact: true, onStarted: (r) => this.api.openExhibition(r.id) })]),
          h('section', { class: 'pbox st-card' },
            h('h2', null, 'Exhibitions this session'),
            exh.length ? h('div', { class: 'exh-list' }, exh.slice().reverse().map(x => h('div', { class: 'exh-row' },
              h('div', null, h('b', null, x.title || `${x.names ? x.names.join(' vs ') : 'Exhibition'}`), h('div', { class: 'muted' }, `Level ${x.level} · ${clockTime(x.at)}`)),
              h('button', { class: 'btn ghost small', onclick: () => this.api.openExhibition(x.id) }, '▶ Watch'))))
              : h('div', { class: 'empty-note' }, 'None yet. The server keeps the last 6 exhibitions.'))),
      ));
  }

  roundCard(matchId, r, cfg) {
    const w = cfg.find(f => f.id === r.result.winnerId);
    const other = r.mode && r.mode !== 'fighter';   // army, business…: an emblem and the headline number instead of a sprite and HP
    const head = other ? (r.resultRows || []).find(x => typeof x[1] === 'number' && typeof x[2] === 'number') : null;
    const side = (f, i) => {
      const v = r.fighters[f.id] || {};
      const pic = other ? h('div', { class: 'rc-emblem', style: `--ec:${(v.colors && v.colors.primary) || f.color}` }, String(v.name || f.label).split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase() || '?')
        : spriteImg(v.sprite || null, v.colors || {}, { alt: v.name || f.label });
      return h('div', { class: `rc-side${r.result.winnerId && r.result.winnerId !== f.id ? ' lost' : ''}`, style: `--c:${f.color}` },
        pic,
        h('div', null, h('div', { class: 'rc-ai' }, f.label), h('div', { class: 'rc-nm' }, v.name || '?'),
          h('div', { class: 'muted' }, other ? (head ? `${head[0]} ${num(Math.round(head[1 + i] * 10) / 10)}` : (v.summary || '')) : `${Math.round((r.result.hpPct || {})[f.id] || 0)}% HP left`)));
    };
    return h('article', { class: 'rcard', style: w ? `--c:${w.color}` : '' },
      h('div', { class: 'rcard-top' },
        h('b', null, `Round ${r.round}`),
        h('span', { class: 'muted' }, [other ? null : r.themeName, `LV ${r.level || Math.min(4, r.round)}`].filter(Boolean).join(' · ')),
        h('span', { class: 'sp' }),
        h('span', { class: 'wtag', style: w ? `--c:${w.color}` : '' }, h('i'), w ? `${w.label} won` : 'Draw')),
      h('div', { class: 'rcard-mid' }, side(cfg[0], 0), h('div', { class: 'rc-vs' }, r.result.method === 'KO' ? `K.O.\n${r.result.time}s` : String(r.result.method || '').toLowerCase()), side(cfg[1], 1)),
      h('button', { class: 'btn small rcard-go', onclick: () => this.api.openReplay(matchId, r.round) }, '▶ Watch'));
  }

  pastMatches(cfg, currentId) {
    const hist = ((this.history && this.history.matches) || []).filter(m => m.matchId !== currentId).slice().reverse();
    const [a, b] = cfg;
    return h('section', { class: 'pbox st-card' },
      h('h2', null, 'Earlier matches'),
      !this.history ? h('div', { class: 'empty-note' }, 'Loading…')
        : !hist.length ? h('div', { class: 'empty-note' }, 'Finished matches show up here.')
          : h('div', { class: 'pm-list' }, hist.map(m => {
            const open = this.expanded.has(m.matchId);
            const w = cfg.find(f => f.id === m.winnerId);
            const sc = m.score || {};
            const rec = this.matchCache[m.matchId];
            const toggle = () => {
              if (open) this.expanded.delete(m.matchId); else { this.expanded.add(m.matchId); this.loadMatch(m.matchId); }
              this.render();
            };
            return h('div', { class: `pm${open ? ' open' : ''}` },
              h('button', { class: 'pm-head', type: 'button', 'aria-expanded': open ? 'true' : 'false', onclick: toggle },
                h('span', { class: 'pm-caret', 'aria-hidden': 'true' }, open ? '▾' : '▸'),
                h('b', null, `Match ${m.matchNumber || '?'}`),
                h('span', { class: 'muted' }, dateTime(m.endedAt || m.startedAt)),
                h('span', { class: 'sp' }),
                h('span', { class: 'pm-score' }, h('span', { style: `color:${a.color}` }, String(sc[a.id] || 0)), ' – ', h('span', { style: `color:${b.color}` }, String(sc[b.id] || 0))),
                h('span', { class: 'wtag', style: w ? `--c:${w.color}` : '' }, h('i'), w ? w.label : 'Level'),
                h('span', { class: 'muted' }, `${(m.rounds || []).length} rounds`)),
              open ? h('div', { class: 'pm-body' }, (m.rounds || []).map(r => {
                const rw = cfg.find(f => f.id === r.winnerId);
                const names = r.names || {};
                return h('div', { class: 'pm-round' },
                  h('b', null, `R${r.round}`),
                  h('span', { class: 'wtag', style: rw ? `--c:${rw.color}` : '' }, h('i'), rw ? rw.label : 'Draw'),
                  h('span', { class: 'muted' }, `${r.method === 'KO' ? `K.O. ${r.time}s` : String(r.method || '').toLowerCase()} · ${names[a.id] || '?'} vs ${names[b.id] || '?'}`),
                  h('span', { class: 'sp' }),
                  rec === 'missing' ? h('span', { class: 'muted' }, 'replay files missing') : h('button', { class: 'btn ghost small', onclick: () => this.api.openReplay(m.matchId, r.round) }, '▶ Watch'));
              })) : null);
          })));
  }
}

