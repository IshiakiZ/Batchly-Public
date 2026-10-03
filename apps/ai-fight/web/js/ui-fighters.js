// ─────────────────────────────────────────────────────────────────────────────
//  FIGHTERS tab: a deep dive into one fighter at a time — every animation,
//  the weapon, full stats with derived numbers, every ability with all its
//  numbers and cost breakdown, traits, look, designer notes, the brain and the
//  fighter's version history across the rounds of this match.
// ─────────────────────────────────────────────────────────────────────────────
import { $, h, clear, add, ago, n2, num, mmss, statKeys, statMeta, realAbilities, basicAttack, archivedAbilities, ultimateOf, offhandOf, relicsOf, godPowersOf, STANCE_INFO, prefStr, setPrefStr } from './util.js';
import { spriteAnimator, spriteImg, tickAnimators } from './sprites.js';
import {
  tabBar, codeView, brainView, statTable, derivedTable, abilityCard, weaponBlock, offhandLine, traitChip, traitChips, sectionHead, lookList,
  spriteAnims, animPlayer, tickTiles, patchNotes, diffChips,
} from './ui-kit.js';

const SECTIONS = [
  { id: 'build', label: 'Build' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'animations', label: 'Animations' },
  { id: 'brain', label: 'Brain' },
  { id: 'history', label: 'History' },
];

export class FightersScreen {
  constructor(api) {
    this.api = api;
    this.root = $('#fighters');
    this.sel = null;
    this.sub = prefStr('aifight-fx-sub', 'build');
    if (!SECTIONS.some(x => x.id === this.sub)) this.sub = 'build';
    this.built = false;
    this.dirty = true;
    this.spriteKey = null;
  }
  get store() { return this.api.store; }
  get cfg() { return this.store.config.fighters; }
  get fighter() { return this.cfg.find(f => f.id === this.sel) || this.cfg[0]; }
  get card() { return this.store.cards[this.fighter.id]; }

  /** Open a specific fighter (and optionally a section). */
  show(id, sub) {
    if (id && this.cfg.some(f => f.id === id)) { this.sel = id; setPrefStr('aifight-fx-sel', id); }
    if (sub && SECTIONS.some(x => x.id === sub)) { this.sub = sub; setPrefStr('aifight-fx-sub', sub); }
    this.dirty = true;
    if (this.built) { this.switcher.select(this.fighter.id, true); this.tabs.select(this.sub, true); }
  }

  enter(opts) {
    if (!this.sel) this.sel = prefStr('aifight-fx-sel', this.cfg[0].id);
    if (!this.cfg.some(f => f.id === this.sel)) this.sel = this.cfg[0].id;
    if (!this.built) this.build();
    if (opts && (opts.id || opts.sub)) this.show(opts.id, opts.sub);
    this.render();
  }

  invalidate() { this.dirty = true; }
  refresh() { if (this.dirty) this.render(); }

  onCard(id, active) {
    if (!active) { this.dirty = true; return; }
    this.updateSwitcher();
    if (id !== this.fighter.id) return;
    this.renderHero();
    this.renderSection();
  }

  tick(now) {
    if (this.dirty) this.render();
    tickAnimators(now);
    tickTiles(now);
  }

  build() {
    const root = clear(this.root);
    this.switcher = tabBar(this.cfg.map(f => ({ id: f.id, label: f.label })), {
      active: this.sel, cls: 'fighter-switch', label: 'Choose a fighter',
      onSelect: (id) => { this.sel = id; setPrefStr('aifight-fx-sel', id); this.spriteKey = null; this.code.reset(); this.render(); },
    });
    this.tabs = tabBar(SECTIONS, {
      active: this.sub, cls: 'page-tabs', label: 'Fighter sections',
      onSelect: (id) => { this.sub = id; setPrefStr('aifight-fx-sub', id); this.renderSection(); this.pane.scrollTop = 0; },
    });
    this.heroEl = h('aside', { class: 'fx-hero pbox' });
    this.pane = h('div', { class: 'fx-pane', role: 'tabpanel' });
    this.code = codeView();
    root.append(
      h('div', { class: 'page-head' }, h('div', { class: 'ph-title' }, this.titleEl = h('h1', null, 'Fighters'), this.subEl = h('div', { class: 'sub' }, 'Everything about each AI’s fighter, and how it changed round by round')), h('span', { class: 'sp' }), this.switcher.el),
      h('div', { class: 'fx-main' }, this.heroEl, h('section', { class: 'fx-content' }, this.tabs.el, this.pane)));
    this.built = true;
  }

  render() {
    this.dirty = false;
    if (!this.built) this.build();
    const mode = this.store.mode && this.store.mode.id && this.store.mode.id !== 'fighter' ? this.store.mode : null;
    this.titleEl.textContent = mode ? `${mode.name}: the builds` : 'Fighters';
    this.subEl.textContent = mode ? `What each AI built: ${mode.designFile || 'its design'}, ${mode.brainFile || 'its brain'} and its notes` : 'Everything about each AI’s fighter, and how it changed round by round';
    this.tabs.el.hidden = !!mode;   // the fighter sections (abilities, animations...) don't apply to other modes
    this.updateSwitcher();
    this.root.style.setProperty('--c', this.fighter.color);
    this.renderHero();
    this.renderSection();
  }

  /** The fighter switcher shows each AI's current fighter name. */
  updateSwitcher() {
    for (const f of this.cfg) {
      const b = this.switcher.button(f.id);
      const c = this.store.cards[f.id];
      if (b) {
        b.style.setProperty('--c', f.color);
        const lbl = b.querySelector('.tab-lbl');
        add(clear(lbl), h('i', { class: 'dot' }), h('b', null, f.label), c && c.exists ? h('span', { class: 'muted' }, ` · ${c.name || c.spec.name}`) : null);
      }
    }
  }

  spriteChanged() {
    const c = this.card;
    const key = c ? JSON.stringify(c.sprite || null).length + ':' + (c.spec && c.spec.colors ? c.spec.colors.primary : '') + ':' + (c.lastChangeAt || 0) : 'none';
    return key !== this.animKey;
  }

  renderHero() {
    const el = clear(this.heroEl);
    const f = this.fighter;
    const card = this.card;
    el.style.setProperty('--c', f.color);
    if (card && card.mode) {   // another game mode (army, business…): the entry at a glance
      this.portrait = null;
      const col = (card.colors && card.colors.primary) || f.color;
      el.append(h('div', { class: 'fx-ai' }, h('i'), f.label.toUpperCase()),
        h('div', { class: 'mode-vs-emblem', style: `--ec:${col};margin:10px 0` }, h('span', null, String(card.name || f.label).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?')),
        h('h2', { class: 'fx-name' }, card.name || f.label),
        card.summary ? h('div', { class: 'fx-sub' }, card.summary) : null,
        h('div', { class: 'fc-meta' }, card.valid ? h('span', { class: 'pill ok' }, '✓ Valid') : h('span', { class: 'pill bad', title: (card.errors || []).join('\n') }, `✗ ${(card.errors || []).length} problem${(card.errors || []).length === 1 ? '' : 's'}`)),
        (card.cardLines || []).length ? h('div', { class: 'mode-lines', style: 'margin-top:10px' }, card.cardLines.map(l => h('div', null, l))) : null);
      return;
    }
    if (!card || !card.exists) {
      el.append(h('div', { class: 'fx-ai' }, h('i'), f.label.toUpperCase()), h('div', { class: 'empty-note' }, `No fighter in fighters/${f.id}/ yet.`));
      this.portrait = null;
      return;
    }
    const spec = card.spec;
    const st = this.store.state;
    const lvl = this.store.rules.levels[st.level || 1] || this.store.rules.levels[4];
    // keep the animated portrait while the sprite is unchanged (so saves don't restart it)
    const pkey = `${f.id}:${card.sprite ? JSON.stringify(card.sprite).length : 0}:${spec.colors ? spec.colors.primary : ''}:${card.spriteStale ? 1 : 0}`;
    if (!this.portrait || this.portrait.key !== pkey || !this.portrait.el) {
      const anim = spriteAnimator(card.sprite, spec.colors, { scale: 6 });
      const tag = h('span', { class: 'frame-tag' }, 'IDLE');
      anim.label = tag;
      this.portrait = { key: pkey, el: h('div', { class: 'fx-portrait', title: 'Cycles through the fighter’s animations — every one is in Animations' }, h('div', { class: 'fx-stage' }, anim.el), tag) };
    }
    const rec = this.record(f.id);
    const wb = weaponBlock(spec, this.store.rules);
    add(el,
      h('div', { class: 'fx-ai' }, h('i'), f.label.toUpperCase(), h('span', { class: 'sp' }), h('span', { class: 'pill gold' }, `LV ${st.level || 1}`)),
      this.portrait.el,
      h('h2', { class: 'fx-name' }, spec.name),
      spec.title ? h('div', { class: 'fx-title' }, spec.title) : null,
      spec.catchphrase ? h('div', { class: 'fx-catch' }, `“${spec.catchphrase}”`) : null,
      h('div', { class: 'fx-meta' },
        card.valid ? h('span', { class: 'pill ok' }, '✓ Valid') : h('span', { class: 'pill bad' }, `✗ ${card.errors.length} problem${card.errors.length === 1 ? '' : 's'}`),
        card.revision ? h('span', { class: 'muted' }, `rev ${card.revision}`) : null,
        h('span', { class: 'muted' }, card.lastChangeAt ? `saved ${ago(card.lastChangeAt)}` : 'no edits yet')),
      !card.valid ? h('ul', { class: 'err-list' }, card.errors.slice(0, 8).map(e => h('li', null, e))) : null,
      spec.description ? h('p', { class: 'fx-desc' }, spec.description) : null,
      wb ? h('div', { class: 'fx-block' }, sectionHead(spec.offhand ? 'Weapons' : 'Weapon', spec.stance && STANCE_INFO[spec.stance] ? h('span', { class: 'pill stance', title: STANCE_INFO[spec.stance].text }, `${STANCE_INFO[spec.stance].icon} ${spec.stance}`) : null), wb, offhandOf(spec, this.store.rules) ? offhandLine(offhandOf(spec, this.store.rules)) : null) : null,
      relicsOf(spec, this.store.rules).length || godPowersOf(spec, this.store.rules).length || spec.awakening ? h('div', { class: 'fx-block' }, sectionHead('Relics & powers'),
        h('div', { class: 'chips' },
          relicsOf(spec, this.store.rules).map(r => h('span', { class: 'relic', title: r.text || r.blurb || r.name }, '◆ ', r.name)),
          godPowersOf(spec, this.store.rules).map(g => h('span', { class: 'godpower', style: g.color ? `--gp:${g.color}` : null, title: `${g.name}${g.blurb ? ` — ${g.blurb}` : ''}` }, '✦ ', g.name)),
          spec.awakening ? h('span', { class: 'awaken-chip', style: spec.awakening.color ? `--aw:${spec.awakening.color}` : null, title: 'Awakening: a once-per-fight transformation' }, '☀ ', spec.awakening.name || 'Awakening') : null)) : null,
      h('div', { class: 'fx-block' }, sectionHead('Traits', `${spec.traits.length}/${lvl.traitSlots}`),
        spec.traits.length ? h('div', { class: 'chips' }, traitChips(this.store, spec.traits)) : h('div', { class: 'muted' }, lvl.traitSlots ? 'No traits picked' : 'Traits unlock at level 2')),
      rec.played ? h('div', { class: 'fx-block' }, sectionHead('This match'),
        h('div', { class: 'fx-record' }, h('b', { class: 'res-w' }, `${rec.w} W`), h('b', { class: 'res-l' }, `${rec.l} L`), rec.d ? h('b', { class: 'res-d' }, `${rec.d} D`) : null, h('span', { class: 'muted' }, `· ${mmss(rec.code)} coding`))) : null,
    );
  }

  /** Every level and what it unlocks (rules.levels; v4 adds relics, arena size and `unlocks`). */
  levelTable() {
    const levels = this.store.rules.levels || {};
    const keys = Object.keys(levels).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (keys.length < 2) return null;
    const cur = this.store.state.level || 1;
    const any = (k) => keys.some(l => levels[l][k] !== undefined);
    const rows = keys.map(l => {
      const L = levels[l];
      const u = Array.isArray(L.unlocks) ? L.unlocks.join(' · ') : (L.unlocks || '');
      return h('tr', { class: l === cur ? 'on' : l < cur ? 'done' : '' },
        h('td', null, String(l)), h('td', { class: 'num' }, String(L.statPoints)), h('td', { class: 'num' }, String(L.statMax)),
        h('td', { class: 'num' }, String(L.abilitySlots)), h('td', { class: 'num' }, String(L.traitSlots)),
        any('relicSlots') ? h('td', { class: 'num' }, String(L.relicSlots || 0)) : null,
        h('td', { class: 'num' }, `${Math.round((L.power || 0) * 100)}%`),
        any('arenaRadius') ? h('td', { class: 'num' }, L.arenaRadius ? String(L.arenaRadius) : '—') : null,
        any('unlocks') ? h('td', { class: 'unl' }, u) : null);
    });
    return h('section', { class: 'fx-sec' }, sectionHead('Levels', `level ${cur} now`),
      h('div', { class: 'table-scroll' }, h('table', { class: 'stat-table level-table' },
        h('thead', null, h('tr', null, h('th', null, 'LV'), h('th', { class: 'num' }, 'Stat pts'), h('th', { class: 'num' }, 'Max/stat'), h('th', { class: 'num' }, 'Abilities'), h('th', { class: 'num' }, 'Traits'),
          any('relicSlots') ? h('th', { class: 'num' }, 'Relics') : null, h('th', { class: 'num' }, 'Power'), any('arenaRadius') ? h('th', { class: 'num' }, 'Arena') : null, any('unlocks') ? h('th', null, 'Unlocks') : null)),
        h('tbody', null, rows))));
  }

  record(id) {
    const rounds = (this.store.match && this.store.match.rounds) || [];
    const r = { played: rounds.length, w: 0, l: 0, d: 0, code: 0 };
    for (const x of rounds) {
      if (!x.result.winnerId) r.d++;
      else if (x.result.winnerId === id) r.w++;
      else r.l++;
      const a = x.activity && x.activity[id];
      if (a && a.codingMs) r.code += a.codingMs;
    }
    return r;
  }

  renderSection() {
    const card = this.card;
    if (card && card.mode) {   // another game mode: its design file and brain, whatever section is picked
      this.sectionKey = null;
      const design = card.design || {}, brain = card.brain || {};
      add(clear(this.pane),
        (card.errors || []).length ? h('div', { class: 'mode-issues bad' }, h('b', null, 'Problems'), card.errors.slice(0, 12).map(e => h('div', null, `• ${e}`))) : null,
        h('div', { class: 'mode-file' }, h('div', { class: 'mode-file-h' }, h('b', null, design.file || 'design'), h('span', { class: 'muted' }, design.source ? `${design.source.split('\n').length} lines` : 'not written yet')), h('pre', { class: 'mode-src' }, design.source || '')),
        h('div', { class: 'mode-file', style: 'margin-top:14px' }, h('div', { class: 'mode-file-h' }, h('b', null, brain.file || 'brain'), h('span', { class: 'muted' }, brain.exists ? `${brain.lines} lines` : 'not written yet')), h('pre', { class: 'mode-src', style: 'max-height:none' }, brain.source || '')),
        card.notes ? h('div', { class: 'mode-file', style: 'margin-top:14px' }, h('div', { class: 'mode-file-h' }, h('b', null, 'notes.md')), h('pre', { class: 'mode-src' }, card.notes)) : null);
      return;
    }
    const key = `${this.fighter.id}:${this.sub}:${card && card.exists ? 1 : 0}`;
    const same = key === this.sectionKey;
    // Update in place where re-building would lose the reader's place.
    if (same && this.sub === 'brain') { this.renderBrain(); return; }
    if (same && this.sub === 'animations' && !this.spriteChanged()) return;
    this.sectionKey = key;
    const pane = clear(this.pane);
    if (!card || !card.exists) { pane.append(h('div', { class: 'empty-note' }, 'Nothing to show yet.')); return; }
    switch (this.sub) {
      case 'build': this.renderBuild(pane); break;
      case 'abilities': this.renderAbilities(pane); break;
      case 'animations': this.renderAnimations(pane); break;
      case 'brain': pane.append(this.code.el); this.renderBrain(); break;
      case 'history': this.renderHistory(pane); break;
      default: break;
    }
  }

  renderBuild(pane) {
    const card = this.card;
    const spec = card.spec;
    const st = this.store.state;
    const lvl = this.store.rules.levels[st.level || 1] || this.store.rules.levels[4];
    const abs = realAbilities(spec);
    const over = (a, b) => (a > b ? 'bad' : '');
    add(pane,
      h('div', { class: 'budget-tiles' },
        h('div', { class: `bt ${over(spec.pointsUsed, lvl.statPoints)}` }, h('span', null, 'Stat points'), h('b', null, `${spec.pointsUsed}/${lvl.statPoints}`), h('small', null, `max ${lvl.statMax} per stat`)),
        h('div', { class: `bt ${over(abs.length, lvl.abilitySlots)}` }, h('span', null, 'Abilities'), h('b', null, `${abs.length}/${lvl.abilitySlots}`), h('small', null, basicAttack(spec) ? '+ the free weapon attack' : ' ')),
        h('div', { class: `bt ${over(spec.traits.length, lvl.traitSlots)}` }, h('span', null, 'Traits'), h('b', null, `${spec.traits.length}/${lvl.traitSlots}`), h('small', null, lvl.traitSlots ? ' ' : 'unlock at level 2')),
        h('div', { class: 'bt' }, h('span', null, 'Power caps'), h('b', null, `${Math.round(lvl.power * 100)}%`), h('small', null, `level ${lvl.level}`))),
      h('section', { class: 'fx-sec' }, sectionHead('Stats'), statTable(this.store, spec, { level: st.level })),
      derivedTable(spec) ? h('section', { class: 'fx-sec' }, sectionHead('What the stats add up to'), derivedTable(spec)) : null,
      spec.traits.length ? h('section', { class: 'fx-sec' }, sectionHead('Traits'),
        h('div', { class: 'trait-list' }, spec.traits.map(id => {
          const t = this.store.rules.traits[id];
          return h('div', { class: 'tl-row' }, traitChip(this.store, id), h('span', null, t ? t.text : id));
        }))) : null,
      card.diff ? h('section', { class: 'fx-sec' }, sectionHead(`Changes vs round ${card.diff.vsRound}`), h('div', { class: 'chips' }, ((c) => (c.length ? c : h('span', { class: 'chip' }, 'no changes yet')))(diffChips(this.store, card.diff, spec)))) : null,
      spec.notes || card.notes ? h('section', { class: 'fx-sec' }, sectionHead('Designer notes'), h('div', { class: 'notes' }, spec.notes || card.notes)) : null,
      spec.look ? h('section', { class: 'fx-sec' }, sectionHead('Look'), lookList(spec.look)) : null,
      this.levelTable(),
      card.warnings && card.warnings.length ? h('section', { class: 'fx-sec' }, sectionHead('Warnings'), h('ul', { class: 'warn-list' }, card.warnings.slice(0, 12).map(w => h('li', null, w)))) : null,
    );
  }

  renderAbilities(pane) {
    const spec = this.card.spec;
    const abs = realAbilities(spec);
    const basic = basicAttack(spec);
    const st = this.store.state;
    const lvl = this.store.rules.levels[st.level || 1] || this.store.rules.levels[4];
    const d = spec.derived || {};
    add(pane,
      h('div', { class: 'muted note-line' }, `${abs.length} of ${lvl.abilitySlots} ability slots used${basic ? ' + the free weapon attack' : ''}. Max energy ${d.maxEnergy !== undefined ? Math.round(d.maxEnergy) : '—'}, regen ${d.energyRegen !== undefined ? `${n2(d.energyRegen)}/s` : '—'}. Costs are computed from each design; traits and stats can then change the final numbers.`),
      h('div', { class: 'ab-cards wide' },
        basic ? abilityCard(basic, spec) : null,
        offhandOf(spec, this.store.rules) && offhandOf(spec, this.store.rules).basic ? abilityCard(offhandOf(spec, this.store.rules).basic, spec) : null,
        ultimateOf(spec) ? abilityCard(Object.assign({ ultimate: true }, ultimateOf(spec)), spec) : null,
        abs.map(ab => abilityCard(ab, spec)),
        abs.length ? null : h('div', { class: 'ab-card empty' }, 'No abilities yet')));
  }

  renderAnimations(pane) {
    const card = this.card;
    const spec = card.spec;
    const anims = spriteAnims(card.sprite, spec.colors);
    this.animKey = JSON.stringify(card.sprite || null).length + ':' + (spec.colors ? spec.colors.primary : '') + ':' + (card.lastChangeAt || 0);
    const files = card.files || {};
    const painted = files['sprite.json'] && files['sprite.json'].exists;
    const palette = card.sprite && card.sprite.palette ? Object.values(card.sprite.palette) : [];
    add(pane,
      h('div', { class: 'muted note-line' }, card.sprite
        ? `${painted ? 'Hand-painted sprite.json' : spec.look ? 'Sprite composed from the look in fighter.json' : 'Sprite'} · ${anims.length} animation${anims.length === 1 ? '' : 's'} · ${anims.reduce((a, x) => a + x.frames, 0)} frames${palette.length ? ` · ${palette.length} colours` : ''}`
        : 'No sprite yet — the default sprite is shown.'),
      h('div', { class: 'anim-grid' }, anims.map(a => h('figure', { class: 'anim-tile' },
        h('div', { class: 'anim-stage' }, animPlayer(card.sprite, spec.colors, a.name, { scale: 4 })),
        h('figcaption', null, h('b', null, a.name), h('span', { class: 'muted' }, `${a.frames} frame${a.frames === 1 ? '' : 's'}`))))),
      palette.length ? h('section', { class: 'fx-sec' }, sectionHead('Palette'), h('div', { class: 'palette' }, palette.map(c => h('span', { class: 'swatch big', title: c, style: `background:${c}` })))) : null,
      spec.look ? h('section', { class: 'fx-sec' }, sectionHead('Look'), lookList(spec.look)) : null,
    );
  }

  renderBrain() {
    const card = this.card;
    if (!card) return;
    const brain = card.brain || {};
    const f = card.files || {};
    const d = card.diff && card.diff.brain;
    const file = (name) => h('span', { class: `file${f[name] && f[name].exists ? ' on' : ''}` }, `${name}${f[name] && f[name].exists ? ' ✓' : ' —'}`);
    const view = brainView(card);
    add(clear(this.code.head),
      h('b', null, 'brain.js'),
      h('span', null, brain.exists ? `${brain.lines} lines` : 'not written yet'),
      d && (d.added || d.removed) ? h('span', { class: 'muted' }, `+${d.added} −${d.removed} vs round ${card.diff.vsRound}`) : null,
      h('span', { class: 'sp' }),
      ...view.chips,
      file('fighter.json'), f['sprite.json'] && f['sprite.json'].exists ? file('sprite.json') : null, f['notes.md'] ? file('notes.md') : null);
    this.code.set(view.source, { exists: !!brain.exists });
  }

  renderHistory(pane) {
    const f = this.fighter;
    const rules = this.store.rules;
    const match = this.store.match || { rounds: [] };
    const rounds = match.rounds || [];
    const card = this.card;
    const st = this.store.state;
    const cards = [];
    // the version being built right now
    if (st.phase === 'building' && card && card.exists) {
      const prev = rounds.length ? rounds[rounds.length - 1].fighters[f.id] : null;
      const notes = prev ? patchNotes(this.store, prev, card.spec) : null;
      cards.push(h('article', { class: 'ver-card now' },
        h('div', { class: 'ver-img' }, spriteImg(card.sprite, card.spec.colors, { alt: card.spec.name })),
        h('div', { class: 'ver-main' },
          h('div', { class: 'ver-top' }, h('span', { class: 'ver-r' }, `ROUND ${st.round} · LV ${st.level || 1}`), h('span', { class: 'pill live' }, '● BUILDING NOW')),
          h('div', { class: 'ver-n' }, card.spec.name, card.spec.title ? h('span', { class: 'muted' }, ` · ${card.spec.title}`) : null),
          this.statLine(card.spec.stats, prev && prev.stats),
          notes && notes.length ? h('div', { class: 'chips' }, notes.map(([k, t]) => h('span', { class: `chip ${k}` }, t))) : null)));
    }
    for (let i = rounds.length - 1; i >= 0; i--) {
      const r = rounds[i];
      const v = r.fighters[f.id];
      if (!v) continue;
      const prev = i > 0 ? rounds[i - 1].fighters[f.id] : null;
      const won = r.result.winnerId === f.id;
      const lost = r.result.winnerId && !won;
      const a = r.activity && r.activity[f.id];
      const notes = prev ? patchNotes(this.store, prev, v) : null;
      cards.push(h('article', { class: `ver-card${won ? ' won' : ''}` },
        h('div', { class: 'ver-img' }, spriteImg(v.sprite, v.colors || {}, { alt: v.name })),
        h('div', { class: 'ver-main' },
          h('div', { class: 'ver-top' },
            h('span', { class: 'ver-r' }, `ROUND ${r.round} · LV ${r.level || Math.min(4, r.round)}`),
            h('span', { class: `pill ${won ? 'ok' : lost ? 'bad' : 'warn'}` }, won ? 'WON' : lost ? 'LOST' : 'DRAW'),
            h('span', { class: 'muted' }, `${r.result.method === 'KO' ? `K.O. ${r.result.time}s` : String(r.result.method).toLowerCase()}${r.themeName ? ` · ${r.themeName}` : ''}`),
            h('span', { class: 'sp' }),
            h('button', { class: 'btn ghost small', onclick: () => this.api.openReplay(match.matchId, r.round) }, '▶ Watch')),
          h('div', { class: 'ver-n' }, v.name, v.title ? h('span', { class: 'muted' }, ` · ${v.title}`) : null),
          this.statLine(v.stats, prev && prev.stats),
          h('div', { class: 'ver-ab' }, archivedAbilities(v, rules).map(x => h('span', { class: 'ver-abi' }, x.name, h('span', { class: 'muted' }, ` ${x.type}${x.energy !== undefined ? ` ⚡${x.energy}` : ''}`))), archivedAbilities(v, rules).length ? null : h('span', { class: 'muted' }, 'no abilities')),
          v.traits && v.traits.length ? h('div', { class: 'chips' }, traitChips(this.store, v.traits)) : null,
          notes && notes.length ? h('div', { class: 'chips' }, h('span', { class: 'muted' }, `vs R${rounds[i - 1].round}:`), notes.map(([k, t]) => h('span', { class: `chip ${k}` }, t))) : null,
          h('div', { class: 'ver-foot muted' },
            `coded ${mmss(a && a.codingMs !== undefined ? a.codingMs : v.buildMs)}`,
            v.autoLocked ? ' · auto-locked (time up)' : '',
            v.brainLines ? ` · brain ${v.brainLines} lines` : '',
            v.brainErrors ? ` · ${v.brainErrors} brain errors` : '',
            v.summary ? ` · dealt ${num(v.summary.dealt)}` : ''),
          v.notes ? h('details', { class: 'ver-notes' }, h('summary', null, 'Designer notes'), h('div', { class: 'notes' }, v.notes)) : null)));
    }
    if (!cards.length) cards.push(h('div', { class: 'empty-note' }, 'No rounds fought yet in this match — each locked-in version shows up here.'));
    add(pane, h('div', { class: 'muted note-line' }, `Every version ${f.label} locked in during match ${match.matchNumber || st.matchNumber}, newest first.`), h('div', { class: 'ver-list' }, cards));
  }

  statLine(stats, prev) {
    const rules = this.store.rules;
    const keys = statKeys(rules, stats);
    return h('div', { class: `ver-stats n${keys.length}` }, keys.map(k => {
      const v = (stats || {})[k] || 0;
      const d = prev ? v - ((prev || {})[k] || 0) : 0;
      return h('span', { class: d > 0 ? 'd-up' : d < 0 ? 'd-down' : '', title: `${statMeta(rules, k).label}${d ? ` ${d > 0 ? '+' : ''}${d}` : ''}` }, h('b', null, String(v)), statMeta(rules, k).short);
    }));
  }
}
