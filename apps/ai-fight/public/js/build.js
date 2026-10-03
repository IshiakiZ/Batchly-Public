// ─────────────────────────────────────────────────────────────────────────────
//  LIVE · building: both AIs designing / evolving their fighters.
//  Each AI gets one focused card (portrait, identity, status + sub-tabs:
//  Overview · Abilities · Brain · Sparring · Activity). The centre column is a
//  single "match control" card: round, the build clock, ready status,
//  prediction, last result and the host buttons.
// ─────────────────────────────────────────────────────────────────────────────
import { $, h, clear, add, ago, fmtClock, mss, weaponOf, realAbilities, basicAttack, weaponIcon, simAt, watchSeconds, ultimateOf, offhandOf, relicsOf, godPowersOf, STANCE_INFO, prefStr, setPrefStr } from './util.js';
import { spriteAnimator, pixelSprite, tickAnimators } from './sprites.js';
import { ArenaRenderer } from './renderer.js';
import { sfx, ui } from './sound.js'; // sound: ui
import { tabBar, codeView, brainView, statGrid, abilityRow, abilityCard, weaponBlock, offhandLine, diffChips, traitChip, sectionHead, feedItem, FEED_ICON } from './ui-kit.js';

const SUBTABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'brain', label: 'Brain' },
  { id: 'sparring', label: 'Sparring' },
  { id: 'activity', label: 'Activity' },
];

/** The current match's game mode when it isn't the fighter duel (bootstrap `mode`), else null. */
export function otherMode(store) { const m = store && store.mode; return m && m.id && m.id !== 'fighter' ? m : null; }

// ── mini sparring arena ──────────────────────────────────────────────────────
class MiniArena {
  constructor(card) {
    this.card = card;
    this.canvas = h('canvas');
    this.label = h('div', { class: 'spar-label' });
    this.empty = h('div', { class: 'spar-empty' }, h('div', { class: 'big-ic' }, '⚔'), h('div', null, 'Sparring fights show up here when this AI runs'), h('code', null, `node arena.js test ${card.id}`));
    this.stage = h('div', { class: 'spar-stage' }, this.canvas, this.label, this.empty);
    this.list = h('div', { class: 'spar-list', role: 'list' });
    this.el = h('div', { class: 'spar' }, this.stage, this.list);
    this.renderer = new ArenaRenderer(this.canvas, { mini: true });
    this.fights = [];
    this.idx = 0;
    this.start = 0;
    this.loadedAt = null;
    this.speed = 2.2;
  }

  /** A newer test never interrupts the fight on screen: it waits until that fight ends. */
  async load(test) {
    if (!test || test.at === this.loadedAt || (this.pending && this.pending.at === test.at)) return false;
    try {
      const r = await fetch(`/api/tests/${this.card.id}?t=${test.at}`);
      if (!r.ok) return false;
      const data = await r.json();
      const fights = (data.fights || []).filter(f => f.replay && f.replay.frames && f.replay.frames.length);
      if (this.fights.length && this.start) {
        this.pending = { at: test.at, fights };
        this.renderList();
        this.markLabel();
      } else this.adopt({ at: test.at, fights }, performance.now());
      return true;
    } catch { return false; }
  }

  adopt(p, now) {
    this.pending = null;
    this.loadedAt = p.at;
    this.fights = p.fights;
    this.idx = 0;
    this.play(now);
    this.renderList();
  }

  markLabel() {
    const tag = this.label.querySelector('.spar-new');
    if (this.pending && !tag) this.label.append(h('span', { class: 'spar-new' }, 'NEW TEST NEXT'));
    else if (!this.pending && tag) tag.remove();
  }

  resultOf(f) {
    return f.result.winner === 0 ? ['WIN', 'res-w'] : f.result.winner === 1 ? ['LOSS', 'res-l'] : ['DRAW', 'res-d'];
  }

  renderList() {
    clear(this.list);
    if (this.pending) {
      const pw = this.pending.fights.filter(f => f.result.winner === 0).length;
      this.list.append(h('div', { class: 'spar-next' }, h('b', null, `New test: ${pw}/${this.pending.fights.length} wins`), h('span', { class: 'muted' }, ' — plays when this fight ends'),
        h('button', { class: 'linkish', type: 'button', onclick: () => this.adopt(this.pending, performance.now()) }, 'watch now')));
    }
    if (!this.fights.length) return;
    const wins = this.fights.filter(f => f.result.winner === 0).length;
    this.list.append(h('div', { class: 'spar-sum' }, h('b', null, `${wins}/${this.fights.length} wins`), h('span', { class: 'muted' }, ` · test ${ago(this.loadedAt)} · click a fight to watch it`)));
    this.fights.forEach((f, i) => {
      const [txt, cls] = this.resultOf(f);
      this.list.append(h('button', {
        class: `spar-row${i === this.idx ? ' on' : ''}`, role: 'listitem', type: 'button',
        onclick: () => { this.idx = i; this.play(performance.now()); this.renderList(); },
      }, h('span', { class: 'sr-play' }, i === this.idx ? '▶' : '·'), h('span', { class: 'sr-opp' }, `vs ${f.oppName}`),
      h('span', { class: `sr-res ${cls}` }, txt), h('span', { class: 'sr-how' }, `${f.result.method === 'KO' ? 'K.O.' : String(f.result.method || '').toLowerCase()} · ${Math.round(f.result.time)}s`)));
    });
  }

  play(now) {
    const f = this.fights[this.idx];
    if (!f) return;
    this.renderer.setReplay(f.replay, [this.card.fighter.color, '#9aa4b1']);
    this.start = now;
    this.empty.hidden = true;
    const [txt, cls] = this.resultOf(f);
    clear(this.label).append(
      h('span', null, `SPAR vs ${f.oppName}${this.fights.length > 1 ? ` · ${this.idx + 1}/${this.fights.length}` : ''}`),
      h('span', { class: cls }, `${txt}${f.result.method === 'KO' ? ' K.O.' : ''} ${Math.round(f.result.time)}s`),
    );
    this.markLabel();
  }

  tick(now) {
    if (!this.fights.length) return;
    const f = this.fights[this.idx];
    const w = ((now - this.start) / 1000) * this.speed; // watch time (incl. cinematic holds)
    const dur = this.renderer.duration;
    if (w > watchSeconds(f.replay, dur) + 2.2) {
      if (this.pending) this.adopt(this.pending, now);
      else { this.idx = (this.idx + 1) % this.fights.length; this.play(now); this.renderList(); }
      return;
    }
    const { t, hold } = simAt(f.replay, w * 1000);
    this.renderer.render(Math.min(t, dur), now / 1000, hold);
  }
}

// ── one AI's card ────────────────────────────────────────────────────────────
class FighterCard {
  constructor(side, api) {
    this.side = side;
    this.api = api;
    this.el = $(`#fcard-${side}`);
    this.spriteKey = null;
    this.lastBrain = null;
    this.lastAbilityNames = null;
    this.built = false;
    this.tab = prefStr(`aifight-ftab-${side}`, 'overview');
    if (!SUBTABS.some(t => t.id === this.tab)) this.tab = 'overview';
    this.unseen = 0;
    this.dirty = {};
  }

  get store() { return this.api.store; }
  get fighter() { return this.store.config.fighters[this.side]; }
  get id() { return this.fighter.id; }
  get card() { return this.store.cards[this.id]; }
  get level() { return this.store.state.level || 1; }
  get lvl() { return this.store.rules.levels[this.level] || this.store.rules.levels[4]; }

  renderAll() {
    const el = clear(this.el);
    el.style.setProperty('--c', this.fighter.color);
    el.setAttribute('aria-label', `${this.fighter.label}'s fighter`);
    this.head = h('header', { class: 'fc-head' });
    this.hero = h('div', { class: 'fc-hero' });
    this.stampEl = h('div', { class: 'stamp', hidden: true }, 'READY!');
    this.tabs = tabBar(SUBTABS, { active: this.tab, cls: 'fc-tabs', label: `${this.fighter.label} details`, onSelect: (id) => this.selectTab(id) });
    this.panes = {};
    for (const t of SUBTABS) {
      this.panes[t.id] = h('div', { class: `fc-pane pane-${t.id}`, role: 'tabpanel', 'aria-labelledby': this.tabs.button(t.id).id, hidden: t.id !== this.tab });
    }
    this.body = h('div', { class: 'fc-body' }, Object.values(this.panes));
    this.emptyEl = h('div', { class: 'fc-empty', hidden: true });
    el.append(this.head, this.hero, this.tabs.el, this.body, this.emptyEl, this.stampEl);
    this.code = codeView();
    this.mini = this.mini || new MiniArena(this);
    this.feedEl = h('div', { class: 'feed', role: 'log', 'aria-live': 'off' });
    this.panes.brain.append(this.code.el);
    this.panes.sparring.append(this.mini.el);
    this.panes.activity.append(this.feedEl);
    this.spriteKey = null;
    this.lastBrain = null;
    this.lastAbilityNames = null;
    this.built = true;
    const om = otherMode(this.store);
    for (const t of ['abilities', 'sparring']) { const b = this.tabs.button(t); if (b) b.hidden = !!om; }
    if (om && (this.tab === 'abilities' || this.tab === 'sparring')) this.tabs.select('overview');
    this.renderHead();
    this.renderBody(false);
    this.renderFeed();
    if (this.store.tests[this.id]) this.mini.load(this.store.tests[this.id]);
    else this.mini.renderList();
  }

  selectTab(id) {
    this.tab = id;
    setPrefStr(`aifight-ftab-${this.side}`, id);
    for (const [k, p] of Object.entries(this.panes)) p.hidden = k !== id;
    this.tabs.setBadge(id, null);
    if (id === 'activity') this.unseen = 0;
    if (this.dirty[id]) { this.dirty[id] = false; this.renderPane(id, false); }
  }

  status() {
    const st = this.store.state;
    const me = st.fighters[this.id] || {};
    const card = this.card;
    const pres = this.store.presence[this.id] || {};
    if (st.phase === 'building') {
      if (me.ready) return ['s-ready', me.autoLocked ? 'Auto-locked' : 'Ready'];
      if (!card || !card.exists) return ['s-idle', 'Waiting'];
      if (!card.revision && st.round === 1) return ['s-idle', 'Starter'];
      return ['s-building', st.round === 1 ? 'Coding' : 'Evolving'];
    }
    if (st.phase === 'match_over') return ['s-idle', 'Match over'];
    if (pres.listening) return ['s-waiting', 'Waiting'];
    return ['s-idle', 'Idle'];
  }

  activityText() {
    const a = (this.store.state.activity || {})[this.id];
    if (!a || !a.firstAt) return 'not started';
    const ms = a.codingMs !== null && a.codingMs !== undefined ? a.codingMs : this.api.serverNow() - a.firstAt;
    return `${mss(ms)} · 💾${a.saves} · ⚔${a.tests}`;
  }

  renderHead() {
    if (!this.head) return;
    const pres = this.store.presence[this.id] || {};
    const [cls, label] = this.status();
    this.actEl = h('span', { class: 'fc-act', title: 'Coding time this round (from this AI’s first save / arena command until it locked in) · 💾 file saves · ⚔ test fights' }, h('span', { class: 'kb', 'aria-hidden': 'true' }, '⌨'), h('span', { class: 'fc-act-t' }, this.activityText()));
    add(clear(this.head), 
      h('span', { class: 'fc-ai' }, h('i'), this.fighter.label.toUpperCase()),
      h('span', { class: 'pill gold', title: `Level = round number (max 12): ${this.lvl.statPoints} stat points, ${this.lvl.abilitySlots} ability slots, ${this.lvl.traitSlots} trait slots, power caps ${Math.round(this.lvl.power * 100)}%` }, `LV ${this.level}`),
      h('span', { class: `pill status ${cls}` }, label),
      h('span', { class: 'sp' }),
      this.store.state.phase === 'building' ? this.actEl : null,
      h('span', { class: `listen${pres.listening ? ' on' : ''}`, title: pres.listening ? 'Listening: the AI is running `ready` / `wait` and will hear your decision' : 'Not listening: the AI is not running `ready` / `wait` right now' }, h('i'), h('span', { class: 'lt' }, pres.listening ? 'listening' : 'not listening')),
    );
    const st = this.store.state;
    const me = st.fighters[this.id] || {};
    const ready = st.phase === 'building' && me.ready;
    this.stampEl.hidden = !ready;
    this.stampEl.textContent = me.autoLocked ? 'TIME UP!' : 'READY!';
    this.stampEl.classList.toggle('auto', !!me.autoLocked);
  }

  // Hero: portrait + name + the one-line essentials + the latest message/action.
  renderHero(animate) {
    const card = this.card;
    if (card.mode) return this.renderModeHero(card);
    const spec = card.spec;
    let entry = null;
    try { entry = pixelSprite(card.sprite, spec.colors); } catch { entry = null; }
    const key = (entry && entry.key) || `${card.sprite ? JSON.stringify(card.sprite).length : 0}:${spec.colors ? spec.colors.primary : ''}`;
    const changed = this.spriteKey !== null && this.spriteKey !== key;
    if (!this.portraitEl || this.spriteKey !== key) {
      const anim = spriteAnimator(card.sprite, spec.colors, { scale: 4 });
      const tag = h('span', { class: 'frame-tag' }, 'IDLE');
      anim.label = tag;
      const counts = Object.entries((entry && entry.frames) || {}).map(([k, v]) => `${k} ${v.length}`).join(' · ');
      this.portraitEl = h('div', { class: `fc-portrait${animate && changed ? ' updated' : ''}`, title: card.sprite ? `Animation frames: ${counts}` : 'Default sprite (no sprite.json yet)' },
        h('div', { class: 'fc-stage' }, anim.el), tag);
      this.spriteKey = key;
    }
    const w = weaponOf(spec, this.store.rules);
    const basic = basicAttack(spec);
    const valid = card.valid
      ? h('span', { class: 'pill ok' }, '✓ Valid')
      : h('span', { class: 'pill bad', title: card.errors.join('\n') }, `✗ ${card.errors.length} problem${card.errors.length === 1 ? '' : 's'}`);
    this.agoEl = h('span', { class: 'fc-ago' }, card.lastChangeAt ? `saved ${ago(card.lastChangeAt)}` : 'no edits yet');
    this.latestEl = h('div', { class: 'fc-latest' });
    add(clear(this.hero),
      this.portraitEl,
      h('div', { class: 'fc-ident' },
        h('h2', { class: 'fc-name' }, spec.name),
        spec.title || spec.catchphrase ? h('div', { class: 'fc-sub' }, spec.title || '', spec.title && spec.catchphrase ? h('span', { class: 'muted' }, ' · ') : null, spec.catchphrase ? h('i', null, `“${spec.catchphrase}”`) : null) : null,
        h('div', { class: 'fc-meta' },
          valid,
          w ? h('span', { class: 'pill weapon', title: `${w.name}${w.kind ? ` (${w.kind})` : ''}${basic ? ` — ${basic.name}` : ''}${w.passiveText ? `\n${w.passiveText}` : ''}` }, h('span', { class: 'mini-ic' }, weaponIcon(w, basic)), w.name, spec.offhand ? ` / ${offhandOf(spec, this.store.rules).name}` : '') : null,
          spec.stance && STANCE_INFO[spec.stance] ? h('span', { class: 'pill stance', title: `Starting stance — ${STANCE_INFO[spec.stance].text}` }, `${STANCE_INFO[spec.stance].icon} ${spec.stance}`) : null,
          card.revision ? h('span', { class: 'muted' }, `rev ${card.revision}`) : null,
          this.agoEl),
        this.latestEl),
    );
    this.renderLatest();
    if (animate && changed) { const el = this.portraitEl; setTimeout(() => el.classList.remove('updated'), 900); }
  }

  /** The latest message and the latest action of this AI (updated on every feed event). */
  renderLatest() {
    if (!this.latestEl) return;
    const lastSay = this.lastOf(['say']);
    const lastAct = this.lastOf(['file', 'test', 'ready', 'error']);
    add(clear(this.latestEl),
      lastSay ? h('div', { class: 'say', title: lastSay.text }, h('span', { class: 'q' }, '💬'), h('span', { class: 'say-t' }, lastSay.text), h('span', { class: 'when', 'data-at': lastSay.at }, ago(lastSay.at))) : null,
      lastAct ? h('div', { class: `act k-${lastAct.kind}`, title: lastAct.text }, h('span', { class: 'q' }, FEED_ICON[lastAct.kind] || '•'), h('span', { class: 'act-t' }, lastAct.text), h('span', { class: 'when', 'data-at': lastAct.at }, ago(lastAct.at))) : null,
      !lastSay && !lastAct ? h('div', { class: 'fc-hint' }, 'Messages and saves appear here as the AI works.') : null);
  }

  lastOf(kinds) {
    const list = this.store.feeds[this.id] || [];
    for (let i = list.length - 1; i >= 0; i--) if (kinds.includes(list[i].kind)) return list[i];
    return null;
  }

  renderBody(animate = true) {
    const card = this.card;
    const hasFighter = !!(card && card.exists);
    this.hero.hidden = !hasFighter;
    this.tabs.el.hidden = !hasFighter;
    this.body.hidden = !hasFighter;
    this.emptyEl.hidden = hasFighter;
    if (!hasFighter) {
      clear(this.emptyEl).append(h('div', null,
        h('div', { class: 'spinner-px' }),
        h('div', { class: 'big' }, `WAITING FOR ${this.fighter.label.toUpperCase()}`),
        h('div', { class: 'muted' }, `fighters/${this.id}/ is empty. Starting a new match installs the Rookie starter here.`)));
      return;
    }
    this.renderHero(animate);
    const brainChanged = this.lastBrain !== null && (card.brain && card.brain.source) !== this.lastBrain;
    const names = realAbilities(card.spec).map(a => a.name).join('|');
    const abilitiesChanged = this.lastAbilityNames !== null && names !== this.lastAbilityNames;
    for (const t of ['overview', 'abilities']) {
      if (t === this.tab) this.renderPane(t, animate); else this.dirty[t] = true;
    }
    this.renderBrain(animate);
    if (animate && brainChanged && this.tab !== 'brain') this.tabs.setBadge('brain', true, 'dot');
    if (animate && abilitiesChanged && this.tab !== 'abilities') this.tabs.setBadge('abilities', true, 'dot');
    this.tabs.setBadge('overview', card.valid ? null : '!', 'bad');
    this.lastAbilityNames = names;
  }

  /** Another game mode: an emblem, the entry's name, its one-line summary and the latest activity. */
  renderModeHero(card) {
    const col = (card.colors && card.colors.primary) || this.fighter.color;
    const initials = String(card.name || this.fighter.label).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
    const valid = card.valid
      ? h('span', { class: 'pill ok' }, '✓ Valid')
      : h('span', { class: 'pill bad', title: card.errors.join('\n') }, `✗ ${card.errors.length} problem${card.errors.length === 1 ? '' : 's'}`);
    this.agoEl = h('span', { class: 'fc-ago' }, card.lastChangeAt ? `saved ${ago(card.lastChangeAt)}` : 'no edits yet');
    this.latestEl = h('div', { class: 'fc-latest' });
    add(clear(this.hero),
      h('div', { class: 'fc-portrait mode-emblem', style: `--ec:${col}` }, h('span', null, initials)),
      h('div', { class: 'fc-ident' },
        h('h2', { class: 'fc-name' }, card.name || this.fighter.label),
        card.summary ? h('div', { class: 'fc-sub' }, card.summary) : null,
        h('div', { class: 'fc-meta' }, valid, card.revision ? h('span', { class: 'muted' }, `rev ${card.revision}`) : null, this.agoEl),
        this.latestEl));
    this.renderLatest();
  }

  /** Another game mode's overview: the key lines, problems, and the design file itself. */
  renderModeOverview() {
    const card = this.card, p = this.panes.overview;
    const design = card.design || {};
    add(clear(p),
      (card.cardLines || []).length ? h('div', { class: 'mode-lines' }, card.cardLines.map(l => h('div', null, l))) : null,
      card.errors.length ? h('div', { class: 'mode-issues bad' }, h('b', null, 'Problems'), card.errors.slice(0, 12).map(e => h('div', null, `• ${e}`))) : null,
      (card.warnings || []).length ? h('div', { class: 'mode-issues warn' }, h('b', null, 'Warnings'), card.warnings.slice(0, 8).map(e => h('div', null, `• ${e}`))) : null,
      h('div', { class: 'mode-file' }, h('div', { class: 'mode-file-h' }, h('b', null, design.file || 'design'), h('span', { class: 'muted' }, design.source ? `${design.source.split('\n').length} lines` : 'not written yet')),
        h('pre', { class: 'mode-src' }, design.source || '')));
  }

  renderPane(id, animate) {
    if (this.card && this.card.mode) { if (id === 'overview') this.renderModeOverview(); return; }
    if (id === 'overview') this.renderOverview(animate);
    else if (id === 'abilities') this.renderAbilities(animate);
  }

  // Overview: the essentials at a glance.
  renderOverview(animate) {
    const pane = clear(this.panes.overview);
    const card = this.card;
    const spec = card.spec;
    const lvl = this.lvl;
    const over = (a, b) => (a > b ? ' over' : '');
    if (!card.valid) {
      pane.append(h('div', { class: 'callout-bad' },
        h('b', null, `✗ ${card.errors.length} problem${card.errors.length === 1 ? '' : 's'}${card.stale ? ' — showing the last valid version' : ''}`),
        h('ul', null, card.errors.slice(0, 6).map(e => h('li', null, e)), card.errors.length > 6 ? h('li', null, `…and ${card.errors.length - 6} more`) : null)));
    }
    const wb = weaponBlock(spec, this.store.rules, { compact: true });
    const off = offhandOf(spec, this.store.rules);
    if (wb) pane.append(h('section', { class: 'ov-sec' }, sectionHead(off ? 'Weapons' : 'Weapon', off ? 'swap between them' : null), wb, off ? offhandLine(off) : null));
    // v4 extras: ultimate, relics, godly powers (only when the fighter has them)
    const ult = ultimateOf(spec);
    if (ult) pane.append(h('section', { class: 'ov-sec' }, sectionHead('Ultimate', 'fires on a full charge'), abilityRow(Object.assign({ ultimate: true }, ult), spec)));
    const relics = relicsOf(spec, this.store.rules);
    const gods = godPowersOf(spec, this.store.rules);
    if (relics.length || gods.length || spec.awakening) {
      add(pane, h('section', { class: 'ov-sec' }, sectionHead('Relics & powers'),
        h('div', { class: 'chips' },
          relics.map(r => h('span', { class: 'relic', title: r.text || r.blurb || r.name }, '◆ ', r.name)),
          gods.map(g => h('span', { class: 'godpower', style: g.color ? `--gp:${g.color}` : null, title: `${g.name}${g.blurb ? ` — ${g.blurb}` : ''} (costs a full divinity meter)` }, '✦ ', g.name)),
          spec.awakening ? h('span', { class: 'awaken-chip', style: spec.awakening.color ? `--aw:${spec.awakening.color}` : null, title: 'Awakening: a once-per-fight transformation' }, '☀ ', spec.awakening.name || 'Awakening') : null)));
    }
    pane.append(h('section', { class: 'ov-sec' },
      sectionHead('Stats', h('span', { class: over(spec.pointsUsed, lvl.statPoints) }, `${spec.pointsUsed}/${lvl.statPoints} pts`)),
      statGrid(this.store, spec, { cols: 2 })));
    // traits
    const traits = h('div', { class: 'chips' });
    for (const t of spec.traits) traits.append(traitChip(this.store, t));
    for (let i = spec.traits.length; i < lvl.traitSlots; i++) traits.append(h('span', { class: 'trait empty' }, 'empty slot'));
    if (!lvl.traitSlots && !spec.traits.length) traits.append(h('span', { class: 'trait empty' }, 'traits unlock at level 2'));
    pane.append(h('section', { class: 'ov-sec' }, sectionHead('Traits', h('span', { class: over(spec.traits.length, lvl.traitSlots) }, `${spec.traits.length}/${lvl.traitSlots}`)), traits));
    // abilities (compact rows)
    const abs = realAbilities(spec);
    const prev = new Set((this.lastAbilityNames || '').split('|'));
    const list = h('div', { class: 'ab-rows' });
    for (const ab of abs) list.append(abilityRow(ab, spec, { isNew: animate && this.lastAbilityNames !== null && !prev.has(ab.name) }));
    const free = lvl.abilitySlots - abs.length;
    if (free > 0) list.append(h('div', { class: 'ab-empty' }, `${free} empty slot${free > 1 ? 's' : ''}`));
    const locked = this.lockedSlots(abs.length);
    if (locked) list.append(h('div', { class: 'ab-locked' }, locked));
    pane.append(h('section', { class: 'ov-sec' }, sectionHead('Abilities', h('span', { class: over(abs.length, lvl.abilitySlots) }, `${abs.length}/${lvl.abilitySlots} · power ${Math.round(lvl.power * 100)}%`)), list));
    // what changed since the last round
    const d = card.diff;
    if (d) {
      const chips = diffChips(this.store, d, card.spec);
      pane.append(h('section', { class: 'ov-sec' }, sectionHead(`Changes vs round ${d.vsRound}`),
        h('div', { class: 'chips' }, chips.length ? chips : h('span', { class: 'chip' }, 'no changes yet'))));
    }
    const notes = spec.notes || card.notes;
    if (notes) {
      const box = h('div', { class: 'notes clamp' }, notes.slice(0, 1500));
      const more = h('button', { class: 'linkish', type: 'button', onclick: () => { box.classList.toggle('clamp'); more.textContent = box.classList.contains('clamp') ? 'Show all' : 'Show less'; } }, 'Show all');
      pane.append(h('section', { class: 'ov-sec' }, sectionHead('Designer notes', more), box));
    } else if (spec.description) {
      pane.append(h('section', { class: 'ov-sec' }, sectionHead('About'), h('div', { class: 'notes' }, spec.description)));
    }
  }

  lockedSlots(used) {
    const levels = this.store.rules.levels;
    const slots = this.lvl.abilitySlots;
    const maxSlots = this.store.rules.maxAbilities || 5;
    const parts = [];
    for (let i = Math.max(slots, used); i < maxSlots; i++) {
      let unlock = null;
      for (let l = 1; l <= (this.store.rules.maxLevel || 12); l++) if (levels[l] && levels[l].abilitySlots > i) { unlock = l; break; }
      parts.push(`slot ${i + 1} at LV ${unlock || '?'}`);
    }
    return parts.length ? `🔒 ${parts.join(' · ')}` : null;
  }

  renderAbilities(animate) {
    const pane = clear(this.panes.abilities);
    const spec = this.card.spec;
    const abs = realAbilities(spec);
    const basic = basicAttack(spec);
    const prev = new Set((this.lastAbilityNames || '').split('|'));
    const grid = h('div', { class: 'ab-cards' });
    if (basic) grid.append(abilityCard(basic, spec));
    const off = offhandOf(spec, this.store.rules);
    if (off && off.basic) grid.append(abilityCard(off.basic, spec));
    const ult = ultimateOf(spec);
    if (ult) grid.append(abilityCard(Object.assign({ ultimate: true }, ult), spec));
    for (const ab of abs) grid.append(abilityCard(ab, spec, { isNew: animate && this.lastAbilityNames !== null && !prev.has(ab.name) }));
    for (let i = abs.length; i < this.lvl.abilitySlots; i++) grid.append(h('div', { class: 'ab-card empty' }, 'empty slot'));
    pane.append(grid);
    const locked = this.lockedSlots(abs.length);
    if (locked) pane.append(h('div', { class: 'ab-locked' }, locked));
  }

  renderBrain(animate) {
    const card = this.card;
    const brain = card.brain || {};
    const f = card.files || {};
    const d = card.diff && card.diff.brain;
    const file = (name) => h('span', { class: `file${f[name] && f[name].exists ? ' on' : ''}` }, `${name}${f[name] && f[name].exists ? ' ✓' : ' —'}`);
    const view = brainView(card);
    add(clear(this.code.head),
      h('b', null, card.mode && brain.file ? brain.file : 'brain.js'),
      h('span', null, brain.exists ? `${brain.lines} lines` : 'not written yet'),
      d && (d.added || d.removed) ? h('span', { class: 'muted', title: `Changes since the fighter that fought round ${card.diff.vsRound}` }, `+${d.added} −${d.removed} vs R${card.diff.vsRound}`) : null,
      h('span', { class: 'sp' }),
      ...view.chips,
      card.mode ? (card.design && card.design.file ? file(card.design.file) : null) : file('fighter.json'), !card.mode && f['sprite.json'] && f['sprite.json'].exists ? file('sprite.json') : null, f['notes.md'] ? file('notes.md') : null,
    );
    this.code.set(view.source, { animate, exists: !!brain.exists });
    this.lastBrain = brain.source || '';
  }

  renderFeed() {
    if (!this.feedEl) return;
    clear(this.feedEl);
    const list = (this.store.feeds[this.id] || []).slice(-80);
    if (!list.length) this.feedEl.append(h('div', { class: 'empty-note' }, 'Saves, messages and sparring results show up here.'));
    for (let i = list.length - 1; i >= 0; i--) this.feedEl.append(feedItem(list[i]));
  }

  addFeed(f) {
    if (!this.feedEl) return;
    const empty = this.feedEl.querySelector('.empty-note');
    if (empty) empty.remove();
    this.feedEl.prepend(feedItem(f, { fresh: true }));
    while (this.feedEl.children.length > 100) this.feedEl.lastChild.remove();
    if (this.tab !== 'activity') { this.unseen++; this.tabs.setBadge('activity', this.unseen > 99 ? '99+' : this.unseen); }
    this.renderLatest();
  }

  onTest() {
    if (!this.mini || otherMode(this.store)) return;
    this.mini.load(this.store.tests[this.id]).then((ok) => {
      if (ok && this.tab !== 'sparring') {
        const f = (this.mini.pending || this.mini).fights;
        this.tabs.setBadge('sparring', f.length ? `${f.filter(x => x.result.winner === 0).length}/${f.length}` : true, 'good');
      }
    });
  }

  tick(now) { if (this.mini && this.built && this.tab === 'sparring' && !this.body.hidden) this.mini.tick(now); }

  slowTick() {
    const card = this.card;
    if (this.agoEl && card && card.lastChangeAt) this.agoEl.textContent = `saved ${ago(card.lastChangeAt)}`;
    if (this.actEl) this.actEl.lastChild.textContent = this.activityText();
    for (const w of this.hero.querySelectorAll('.when[data-at]')) w.textContent = ago(Number(w.dataset.at));
  }
}

// ── the screen ───────────────────────────────────────────────────────────────
export class BuildScreen {
  constructor(api) {
    this.api = api;
    this.cards = [new FighterCard(0, api), new FighterCard(1, api)];
    this.center = $('#match-control');
    this.lastRemain = null;
  }
  get store() { return this.api.store; }

  cardFor(id) { return this.cards.find(p => p.id === id); }

  renderAll() {
    for (const p of this.cards) p.renderAll();
    this.renderCenter();
  }

  // Saves often arrive in bursts: re-render each card at most every ~150 ms (no flicker).
  onCard(id) {
    this.cardQueue = this.cardQueue || new Set();
    this.cardQueue.add(id);
    if (this.cardTimer) return;
    this.cardTimer = setTimeout(() => {
      this.cardTimer = null;
      const ids = [...this.cardQueue];
      this.cardQueue.clear();
      for (const cid of ids) {
        const p = this.cardFor(cid);
        if (!p || !p.built) continue;
        p.renderHead();
        p.renderBody(true);
      }
      this.renderCenter();
    }, 150);
  }

  onFeed(f) {
    const p = this.cardFor(f.who);
    if (p) p.addFeed(f);   // silent: the AIs' coding activity (saves, messages, tests) plays no sounds
  }

  onActivity(id) {
    const p = this.cardFor(id);
    if (p && p.actEl) p.actEl.lastChild.textContent = p.activityText();
  }

  onTest(id) { const p = this.cardFor(id); if (p) p.onTest(); }

  onPresence(id) { const p = this.cardFor(id); if (p) p.renderHead(); }

  onState(prev) {
    const st = this.store.state;
    for (const p of this.cards) p.renderHead();
    if (prev && (prev.round !== st.round || prev.matchId !== st.matchId)) {
      for (const p of this.cards) p.renderBody(false);
      if (st.phase === 'building' && st.round > 1 && prev.matchId === st.matchId) sfx.levelUp(st.round); // sound: bigger fanfare at 5, 8, 10, 12
    }
    if (prev && prev.matchId === st.matchId && prev.round === st.round) {
      for (const f of this.store.config.fighters) {
        const was = (prev.fighters[f.id] || {}).ready, now = (st.fighters[f.id] || {}).ready;
        if (!was && now) ui(st.fighters[f.id].autoLocked ? 'autolock' : 'lock'); // sound: lock-in
      }
    }
    this.renderCenter();
  }

  // The cards stay up to date while other tabs are shown (every event reaches them),
  // so coming back only refreshes the header lines and the centre card.
  enter() {
    if (this.cards.some(p => !p.built)) this.renderAll();
    else { for (const p of this.cards) p.renderHead(); this.renderCenter(); }
    this.lastRemain = null;
  }

  tick(now) {
    for (const p of this.cards) p.tick(now);
    tickAnimators(now);
    this.updateClock();
  }

  slowTick() {
    for (const p of this.cards) p.slowTick();
    // clock warnings: alarm at 1:00, ticks through the last 10 seconds
    const st = this.store.state;
    const rem = this.clockRemaining();
    const c = st.clockInfo;
    if (this.lastRemain !== null && this.lastRemain <= 10 && c && c.expired) ui('timeup'); // sound: time up (once: lastRemain resets below)
    if (st.phase === 'building' && rem !== null && c && c.started && !c.paused && !c.expired) {
      const sec = Math.ceil(rem / 1000);
      if (this.lastRemain !== null && this.lastRemain > 60 && sec <= 60) ui('clock60'); // sound:
      else if (sec <= 10 && sec > 0 && sec !== this.lastRemain) ui('tick', sec); // sound: last 3 s tick higher
      this.lastRemain = sec;
    } else this.lastRemain = null;
  }

  // ── build clock ───────────────────────────────────────────────────────────
  clockRemaining() {
    const c = this.store.state.clockInfo;
    if (!c || !c.enabled) return null;
    if (c.expired) return 0;
    if (!c.started) return c.limitMs;
    if (c.paused || !c.deadline) return c.remainingMs;
    return Math.max(0, c.deadline - this.api.serverNow());
  }

  /** "4:12 left" style text for the top bar (null when there is no clock). */
  clockText() {
    const st = this.store.state;
    if (st.phase !== 'building') return null;
    const c = st.clockInfo || {};
    const rem = this.clockRemaining();
    if (rem === null) return null;
    if (c.expired) return 'time up';
    if (!c.started) return `${mss(rem)} limit`;
    if (c.paused) return `${mss(rem)} paused`;
    return `${mss(rem)} left`;
  }

  updateClock() {
    if (!this.clockBig) return;
    const st = this.store.state;
    const c = st.clockInfo;
    const rem = this.clockRemaining();
    let text, cls = '';
    if (rem === null) { text = fmtClock(this.api.serverNow() - (st.buildStartedAt || Date.now())); cls = 'off'; }
    else {
      text = mss(rem);
      if (c.expired) cls = 'danger';
      else if (!c.started) cls = 'idle';
      else if (c.paused) cls = 'paused';
      else if (rem <= 10000) cls = 'danger';
      else if (rem <= 60000) cls = 'warn';
    }
    if (this.clockBig.textContent !== text) this.clockBig.textContent = text;
    const full = `mc-clock ${cls}`;
    if (this.clockBox.className !== full) this.clockBox.className = full;
    if (this.clockBar && rem !== null && c.limitMs) this.clockBar.style.width = `${Math.max(0, Math.min(100, (rem / c.limitMs) * 100))}%`;
  }

  clockBlock() {
    const st = this.store.state;
    const c = st.clockInfo || {};
    const building = st.phase === 'building';
    this.clockBig = h('div', { class: 'big', role: 'timer', 'aria-live': 'off' });
    this.clockBar = c.enabled ? h('i') : null;
    let label, sub;
    if (!c.enabled) { label = 'Build time'; sub = 'No time limit this round (Settings)'; }
    else if (c.expired) { label = 'Time up'; sub = 'Unready fighters were auto-locked'; }
    else if (!c.started) { label = 'Time limit'; sub = 'Starts when either AI starts working'; }
    else if (c.paused) { label = 'Paused'; sub = 'The host paused the clock'; }
    else { label = 'Time left'; sub = 'Auto-lock at 0:00'; }
    const ctl = [];
    if (building && c.enabled && !c.expired) {
      if (!c.started) ctl.push(h('button', { class: 'btn good small', title: 'Start the build clock now (P)', onclick: () => this.api.host('clock-start') }, '▶ Start'));
      else if (c.paused) ctl.push(h('button', { class: 'btn good small', title: 'Resume the build clock (P)', onclick: () => this.api.host('clock-resume') }, '▶ Resume'));
      else ctl.push(h('button', { class: 'btn small', title: 'Pause the build clock (P)', onclick: () => this.api.host('clock-pause') }, '⏸ Pause'));
      ctl.push(h('button', { class: 'btn small', title: 'Give both AIs one more minute (T)', onclick: () => this.api.host('clock-add') }, '+1:00'));
    }
    this.clockBox = h('div', { class: 'mc-clock' },
      h('div', { class: 'mc-lbl' }, label),
      this.clockBig,
      this.clockBar ? h('div', { class: 'bar' }, this.clockBar) : null,
      h('div', { class: 'sub' }, sub),
      ctl.length ? h('div', { class: 'ctl' }, ctl) : null);
    this.updateClock();
    return this.clockBox;
  }

  levelUpLine() {
    const st = this.store.state;
    if (st.round < 2) return null;
    const om = otherMode(this.store);
    if (om) {
      const L = (om.levels || {})[st.level || st.round] || {};
      const u = (L.unlocks || []).join(' · ') || L.headline || '';
      return u ? h('div', { class: 'mc-lvlup', title: u }, h('b', null, 'LEVEL UP!'), ` ${u}`) : null;
    }
    const levels = this.store.rules.levels;
    const cur = levels[st.level || 1], prev = levels[Math.max(1, (st.level || 1) - 1)];
    if (!cur || !prev) return null;
    if (cur.level === prev.level || st.round > cur.level) return h('div', { class: 'mc-lvlup max', title: 'Every choice is open: re-spec anything' }, h('b', null, 'MAX LEVEL'), ' free re-spec');
    const bits = [`+${cur.statPoints - prev.statPoints} stat pts`];
    if (cur.abilitySlots > prev.abilitySlots) bits.push(`+${cur.abilitySlots - prev.abilitySlots} ability`);
    if (cur.traitSlots > prev.traitSlots) bits.push(`+${cur.traitSlots - prev.traitSlots} trait`);
    if ((cur.relicSlots || 0) > (prev.relicSlots || 0)) bits.push(`+${cur.relicSlots - (prev.relicSlots || 0)} relic`);
    bits.push(`power ${Math.round(cur.power * 100)}%`);
    return h('div', { class: 'mc-lvlup', title: `Level ${cur.level}: ${cur.statPoints} stat points (max ${cur.statMax} each), ${cur.abilitySlots} ability slots, ${cur.traitSlots} trait slots, power caps ${Math.round(cur.power * 100)}%` }, h('b', null, 'LEVEL UP!'), ` ${bits.join(' · ')}`);
  }

  /** The level track: one pip per level (1–12 in v4); hover a pip for what it unlocks. */
  levelTrack() {
    const om = otherMode(this.store);
    const rules = this.store.rules;
    const levels = om ? (om.levels || {}) : (rules.levels || {});
    const max = om ? (om.maxRounds || 12) : (rules.maxLevel || Math.max(...Object.keys(levels).map(Number).filter(Number.isFinite), 1));
    const cur = this.store.state.level || 1;
    const unlockText = (l) => {
      const L = levels[l] || {};
      const u = Array.isArray(L.unlocks) ? L.unlocks : (L.unlocks ? [String(L.unlocks)] : []);
      return u.length ? u.join(' · ') : '';
    };
    const pips = [];
    for (let l = 1; l <= max; l++) {
      const L = levels[l] || {};
      const u = unlockText(l);
      pips.push(h('span', { class: `lt-pip${l < cur ? ' done' : l === cur ? ' on' : ''}${u ? ' has' : ''}`, title: `Level ${l}${om && L.headline ? ` — ${L.headline}` : ''}${L.statPoints ? ` — ${L.statPoints} stat pts, ${L.abilitySlots} ability slots, ${L.traitSlots} traits${L.relicSlots ? `, ${L.relicSlots} relics` : ''}` : ''}${u ? `\nUnlocks: ${u}` : ''}` }, String(l)));
    }
    const now = unlockText(cur);
    const next = cur < max ? unlockText(cur + 1) : '';
    return h('div', { class: 'mc-track' },
      h('div', { class: 'lt-pips' }, pips),
      now ? h('div', { class: 'lt-now', title: now }, h('b', null, 'Unlocked: '), now) : null,
      !now && next ? h('div', { class: 'lt-now', title: next }, h('span', { class: 'muted' }, `Next (LV ${cur + 1}): `), next) : null);
  }

  predictBlock() {
    const st = this.store.state;
    if (st.phase !== 'building') return null;
    const cfg = this.store.config.fighters;
    return h('section', { class: 'mc-sec mc-predict' },
      h('div', { class: 'mc-lbl' }, `Who wins round ${st.round}?`),
      h('div', { class: 'pr-btns' }, cfg.map((f, i) => h('button', {
        class: `pr-btn${st.prediction === f.id ? ' on' : ''}`, style: `--c:${f.color}`, type: 'button',
        'aria-pressed': st.prediction === f.id ? 'true' : 'false',
        title: `Predict ${f.label} (key ${i + 1}). Click again to clear.`,
        onclick: () => this.api.host('predict', null, { id: st.prediction === f.id ? null : f.id }),
      }, st.prediction === f.id ? `✓ ${f.label}` : f.label, h('kbd', null, String(i + 1))))),
      h('div', { class: 'sub' }, st.prediction ? 'Locked in — scored in the stats and the CSV.' : 'Scored in the stats and the CSV.'));
  }

  renderCenter() {
    const st = this.store.state;
    if (!this.center) return;
    if (st.phase === 'match_over') return this.renderMatchOver();
    const [a, b] = this.store.config.fighters;
    const lvl = this.store.rules.levels[st.level || 1];
    const mirror = st.round === 1 && this.store.config.mirrorFirstRound;
    const readyRow = (f) => {
      const me = st.fighters[f.id] || {};
      const card = this.store.cards[f.id];
      const state = me.ready ? (me.autoLocked ? 'AUTO-LOCKED' : 'READY') : card && card.exists ? (card.valid ? 'BUILDING' : 'INVALID') : 'WAITING';
      return h('div', { class: `rd${me.ready ? ' on' : ''}${me.autoLocked ? ' auto' : ''}${state === 'INVALID' ? ' bad' : ''}`, style: `--c:${f.color}` },
        h('span', { class: 'who' }, h('i'), f.label),
        h('span', { class: 'st' }, me.ready ? `✓ ${state}` : state));
    };
    const lastRound = this.store.match && this.store.match.rounds.length ? this.store.match.rounds[this.store.match.rounds.length - 1] : null;
    const bothValid = [a, b].every(f => (st.fighters[f.id] || {}).ready || (this.store.cards[f.id] && this.store.cards[f.id].valid));
    const unread = this.api.logUnread ? this.api.logUnread() : 0;
    add(clear(this.center),
      h('section', { class: 'mc-sec mc-top' },
        h('div', { class: 'mc-round' }, h('span', { class: 'mc-lbl' }, 'Round'), h('b', null, String(st.round))),
        h('div', { class: 'mc-tags' },
          h('span', { class: 'pill gold', title: `${lvl.statPoints} stat points · ${lvl.abilitySlots} ability slots · ${lvl.traitSlots} trait slots · power caps ${Math.round(lvl.power * 100)}%` }, `LEVEL ${st.level || 1}`),
          h('span', { class: 'mc-phase' }, mirror ? 'Mirror match' : st.round >= (this.store.config.finalRound || 12) ? 'FINAL ROUND' : st.round === 2 ? 'First evolution' : 'Evolving')),
        mirror ? h('div', { class: 'mc-note' }, 'Same starter body — only the brains differ') : this.levelUpLine(),
        this.levelTrack(),
        st.theme && !otherMode(this.store) ? h('div', { class: 'mc-theme', title: 'Every round is fought in a different arena (the look changes, the rules don’t)' }, `Arena: ${st.theme.name}`) : null),
      h('section', { class: 'mc-sec' }, this.clockBlock()),
      h('section', { class: 'mc-sec mc-ready' }, h('div', { class: 'mc-lbl' }, 'Lock-in'), readyRow(a), readyRow(b)),
      this.predictBlock(),
      st.lastResult ? h('section', { class: 'mc-sec mc-last' }, h('div', { class: 'mc-lbl' }, 'Last round'), h('div', { class: 'txt' }, st.lastResult),
        lastRound ? h('button', { class: 'btn ghost small', onclick: () => this.api.openReplay(this.store.match.matchId, lastRound.round) }, '↺ Watch replay', h('kbd', null, 'R')) : null) : null,
      h('section', { class: 'mc-sec mc-actions' },
        h('button', { class: 'btn', disabled: !bothValid, title: bothValid ? 'Lock in whatever each AI has right now and start the fight (F)' : 'Both fighters need to be valid first', onclick: () => this.api.host('force-start', 'Start the fight now with each AI’s current files (even if they haven’t marked ready)?') }, '⚡ Force start', h('kbd', null, 'F')),
        h('button', { class: 'btn danger', title: 'End the match and show the final statistics (E)', onclick: () => this.api.host('end', 'End the match now and show the final statistics? The AIs will be told to stop.') }, '■ End match', h('kbd', null, 'E'))),
      h('button', { class: 'mc-log', type: 'button', onclick: () => this.api.toggleLog(), title: 'Everything that happened in this match (G)' },
        h('span', null, '≡ Arena log'), unread ? h('span', { class: 'tab-badge' }, String(unread)) : null, h('kbd', null, 'G')),
    );
  }

  renderMatchOver() {
    const st = this.store.state;
    const [a, b] = this.store.config.fighters;
    const sa = st.score[a.id] || 0, sb = st.score[b.id] || 0;
    const leader = sa === sb ? null : sa > sb ? a : b;
    const rounds = this.store.match ? this.store.match.rounds.length : 0;
    this.clockBig = null;
    add(clear(this.center),
      h('section', { class: 'mc-sec mc-top' },
        h('div', { class: 'mc-lbl' }, `Match ${st.matchNumber}`),
        h('div', { class: 'mc-over' }, 'MATCH OVER'),
        h('div', { class: 'mc-final' }, h('span', { style: `color:${a.color}` }, String(sa)), h('small', null, '–'), h('span', { style: `color:${b.color}` }, String(sb))),
        h('div', { class: 'mc-note' }, leader ? `👑 ${leader.label} wins the match` : 'The match ends level', ` · ${rounds} round${rounds === 1 ? '' : 's'}`)),
      h('section', { class: 'mc-sec mc-actions stack' },
        h('button', { class: 'btn primary', onclick: () => this.api.newMatch() }, '＋ New match…'),
        h('button', { class: 'btn', onclick: () => this.api.go('stats') }, '📊 Final statistics', h('kbd', null, 'S')),
        h('button', { class: 'btn ghost', onclick: () => this.api.go('replays') }, '🎬 Replays', h('kbd', null, 'W'))),
      h('button', { class: 'mc-log', type: 'button', onclick: () => this.api.toggleLog() }, h('span', null, '≡ Arena log'), h('kbd', null, 'G')),
    );
  }
}

