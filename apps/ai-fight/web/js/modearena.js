// ─────────────────────────────────────────────────────────────────────────────
//  The arena screen for the other game modes (army, business, …).
//  The fighter duel keeps its own screen (fight.js). This one loads the mode's
//  renderer (public/js/modes/<id>/view.js, see engine/modes/README.md) and adds
//  the shared chrome: HUD, VS splash, countdown, event ticker, result card and
//  the replay bar. Live playback follows the server clock (no hit-stops here).
// ─────────────────────────────────────────────────────────────────────────────
import { $, h, clear, add, fmtSecs, num } from './util.js';
import { sfx } from './sound.js';

const OUTRO_S = 3.5;   // the server keeps the fighting phase this long after the replay ends

export class ModeArenaScreen {
  constructor(api) {
    this.api = api;
    this.el = $('#screen-modearena');
    this.modules = {};          // mode id -> import() promise
    this.view = null;
    this.viewMode = null;
    this.loadingView = null;
    this.replay = null;
    this.replayKey = null;
    this.loading = null;
    this.mode = 'live';         // 'live' | 'replay'
    this.rp = { playing: true, speed: 1, t: 0, last: null, matchId: null, round: null };
    this.overlayKey = null;
    this.vsShown = null;
    this.lastEvT = null;
    this.tickerItems = [];
    this.hudAt = 0;
    this.build();
  }

  get store() { return this.api.store; }
  colors() { return this.store.config.fighters.map(f => f.color); }

  build() {
    this.hudEl = h('div', { class: 'ma-hud' });
    this.canvas = h('canvas', { class: 'ma-canvas' });
    this.overlay = h('div', { class: 'overlay' });
    this.bar = h('div', { class: 'replay-bar', hidden: true });
    this.stage = h('div', { class: 'ma-stage' }, this.canvas, this.overlay, this.bar);
    this.tickerEl = h('div', { class: 'ticker ma-ticker' });
    add(clear(this.el), this.hudEl, this.stage, this.tickerEl);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(this.stage);
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.max(1, Math.round(r.width * dpr)), hh = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== hh) { this.canvas.width = w; this.canvas.height = hh; }
    if (this.view && this.view.resize) { try { this.view.resize(); } catch (e) { console.error(e); } }
  }

  /** Load (once) and create the renderer for a mode; returns the view or null while loading. */
  viewFor(modeId) {
    if (this.view && this.viewMode === modeId) return this.view;
    if (this.loadingView === modeId) return null;
    this.loadingView = modeId;
    if (!this.modules[modeId]) this.modules[modeId] = import(`./modes/${modeId}/view.js`);
    this.modules[modeId].then((mod) => {
      if (this.loadingView !== modeId) return;
      this.view = mod.createView(this.canvas);
      this.viewMode = modeId;
      this.loadingView = null;
      this.resize();
      if (this.replay && this.replay.mode === modeId) this.view.setReplay(this.replay, this.colors());
    }).catch((e) => {
      console.error('mode view failed to load', e);
      this.loadingView = null;
      clear(this.overlay).append(h('div', { class: 'preparing' }, `The ${modeId} renderer could not be loaded.`));
    });
    return null;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  enter(v) {
    this.mode = v === 'replay' ? 'replay' : 'live';
    this.overlayKey = null;
    this.bar.hidden = this.mode !== 'replay';
    if (this.mode === 'live') {
      const st = this.store.state;
      if (this.replayKey !== `${st.matchId}:${st.round}`) { this.replay = null; this.replayKey = null; }
      this.ensureLiveReplay();
    }
    this.resize();
  }
  refresh(v) { if ((v === 'replay') !== (this.mode === 'replay')) this.enter(v); }
  leave() { this.overlayKey = null; clear(this.overlay); }
  onState(prev) {
    const st = this.store.state;
    if (!prev || prev.phase !== st.phase || prev.round !== st.round) this.overlayKey = null;
    if (['countdown', 'fighting', 'round_over'].includes(st.phase)) this.ensureLiveReplay();
  }
  onMatch() { if (this.overlayKey && this.overlayKey.startsWith('result')) this.overlayKey = null; }

  async ensureLiveReplay() {
    const st = this.store.state;
    const key = `${st.matchId}:${st.round}`;
    if ((this.replayKey === key && this.replay) || this.loading === key) return;
    if (!['countdown', 'fighting', 'round_over'].includes(st.phase)) return;
    this.loading = key;
    for (let tries = 0; tries < 240; tries++) {
      const cur = this.store.state;
      if (`${cur.matchId}:${cur.round}` !== key || !['countdown', 'fighting', 'round_over'].includes(cur.phase)) break;
      try {
        const r = await fetch(`/api/replay/current?k=${encodeURIComponent(key)}&n=${tries}`);
        if (r.ok) {
          const rep = await r.json();
          if (rep && rep.mode && (rep.round === cur.round || rep.round === undefined)) { if (this.mode === 'live') this.setReplay(rep, key); break; }
        }
      } catch { /* retry */ }
      await new Promise(res => setTimeout(res, 400));
    }
    if (this.loading === key) this.loading = null;
  }

  setReplay(rep, key) {
    this.replay = rep;
    this.replayKey = key;
    this.lastEvT = null;
    this.tickerItems = [];
    clear(this.tickerEl);
    this.overlayKey = null;
    const v = this.viewFor(rep.mode);
    if (v) v.setReplay(rep, this.colors());
  }

  async openReplay(matchId, round) {
    this.mode = 'replay';
    this.bar.hidden = false;
    clear(this.bar).append(h('span', { class: 'rb-tag' }, 'Loading…'));
    this.overlayKey = null;
    clear(this.overlay);
    this.replay = null;
    this.replayKey = null;
    this.rp = { playing: true, speed: this.rp.speed || 1, t: 0, last: null, matchId, round };
    try {
      const r = await fetch(`/api/replay/${encodeURIComponent(matchId)}/${round}`);
      if (!r.ok) throw new Error('missing');
      const rep = await r.json();
      if (!rep || !rep.mode) throw new Error('not a mode replay');
      this.setReplay(rep, `replay:${matchId}:${round}`);
      this.buildBar();
    } catch {
      clear(this.overlay).append(h('div', { class: 'preparing' }, 'That replay is not available.'));
    }
  }

  // ── per frame ─────────────────────────────────────────────────────────────
  tick(now) {
    const anim = now / 1000;
    if (this.mode === 'replay') return this.tickReplay(now);
    const st = this.store.state;
    const v = this.viewFor(st.mode);
    if (!v) return;
    const sNow = this.api.serverNow();
    if (st.phase === 'countdown') {
      const left = (st.countdownEndsAt || sNow) - sNow;
      const elapsed = (this.store.rules.countdownMs || 6500) - left;
      if (elapsed < 3600) this.showOverlay('vs');
      else if (left > 0) this.showOverlay('count', Math.min(3, Math.ceil(left / 1000)));
      else this.showOverlay('preparing');
      if (this.replay) v.render(0, anim); else v.renderIdle(anim);
      this.renderHud(0);
    } else if (st.phase === 'fighting') {
      if (!this.replay) { v.renderIdle(anim); this.showOverlay('preparing'); this.ensureLiveReplay(); return; }
      const t = (sNow - st.fightStartsAt) / 1000;
      v.render(t, anim);
      this.renderHud(t);
      this.feedTicker(t);
      if (t < 1) this.showOverlay('go');
      else if (t >= v.duration) this.showOverlay('end');
      else this.showOverlay(null);
    } else if (st.phase === 'round_over') {
      if (this.replay) {
        const t = st.fightStartsAt ? (sNow - st.fightStartsAt) / 1000 : v.duration + OUTRO_S;
        v.render(Math.max(t, v.duration), anim);
        this.renderHud(v.duration);
      } else { v.renderIdle(anim); this.ensureLiveReplay(); }
      this.showOverlay('result');
    } else {
      v.renderIdle(anim);
    }
  }

  tickReplay(now) {
    const anim = now / 1000;
    const rep = this.replay;
    const v = rep ? this.viewFor(rep.mode) : null;
    if (!rep || !v) return;
    const rp = this.rp;
    if (rp.last !== null && rp.playing) rp.t += ((now - rp.last) / 1000) * rp.speed;
    rp.last = now;
    const dur = v.duration;
    if (rp.t >= dur + 1.5) { rp.t = dur; rp.playing = false; this.syncBar(); }
    const t = Math.min(rp.t, dur + 1.5);
    v.render(t, anim);
    this.renderHud(Math.min(t, dur));
    if (rp.playing) this.feedTicker(t);
    this.showOverlay(t >= dur ? 'end' : null);
    if (this.rbRange && document.activeElement !== this.rbRange) this.rbRange.value = String(Math.min(rp.t, dur));
    if (this.rbTime) this.rbTime.textContent = `${fmtSecs(Math.min(rp.t, dur))} / ${fmtSecs(dur)}`;
  }

  togglePlay() {
    if (!this.replay || !this.view) return;
    if (!this.rp.playing && this.rp.t >= this.view.duration) { this.rp.t = 0; this.lastEvT = null; }
    this.rp.playing = !this.rp.playing;
    this.syncBar();
  }

  buildBar() {
    const rp = this.rp;
    const dur = this.view ? this.view.duration : (this.replay.duration || 0);
    this.rbPlay = h('button', { class: 'btn small', title: 'Play / pause (Space)', onclick: () => this.togglePlay() }, '⏸');
    this.rbRange = h('input', { type: 'range', min: '0', max: String(dur), step: '0.01', value: '0', 'aria-label': 'Replay position' });
    this.rbRange.addEventListener('input', () => { rp.t = Number(this.rbRange.value); this.lastEvT = null; });
    this.rbTime = h('span', { class: 'rb-time' }, `0:00 / ${fmtSecs(dur)}`);
    const speed = h('select', { title: 'Playback speed', 'aria-label': 'Playback speed' }, [0.25, 0.5, 1, 2, 4].map(s => { const o = h('option', { value: String(s) }, `${s}×`); if (s === rp.speed) o.selected = true; return o; }));
    speed.addEventListener('change', () => { rp.speed = Number(speed.value); });
    add(clear(this.bar),
      h('span', { class: 'rb-tag' }, `Replay · Round ${rp.round}${rp.matchId !== this.store.state.matchId ? ' (earlier match)' : ''}`),
      this.rbPlay, this.rbRange, this.rbTime, speed,
      h('button', { class: 'btn ghost small', title: 'Restart', onclick: () => { rp.t = 0; rp.playing = true; this.lastEvT = null; this.syncBar(); } }, '↺'),
      h('button', { class: 'btn small', title: 'Close (Esc)', onclick: () => this.api.closeReplay() }, '✕ Close'));
    this.syncBar();
  }
  syncBar() { if (this.rbPlay) this.rbPlay.textContent = this.rp.playing ? '⏸' : '▶'; }

  // ── HUD + ticker ──────────────────────────────────────────────────────────
  renderHud(t) {
    const now = performance.now();
    if (now - this.hudAt < 90) return;   // ~10 updates a second is plenty
    this.hudAt = now;
    const cfg = this.store.config.fighters;
    let sides = [null, null];
    try { sides = (this.view && this.replay && this.view.hudAt(t)) || sides; } catch (e) { console.error(e); }
    const panel = (i) => {
      const s = sides[i] || {};
      const rs = this.replay && this.replay.sides ? this.replay.sides[i] || {} : {};
      return h('div', { class: `ma-side ${i ? 'right' : 'left'}`, style: `--c:${cfg[i].color}` },
        h('div', { class: 'ma-who' }, h('span', { class: 'ma-ai' }, cfg[i].label), h('b', null, s.title || rs.name || '')),
        s.sub ? h('div', { class: 'ma-sub' }, s.sub) : null,
        (s.bars || []).slice(0, 4).map(b => {
          const k = b.max > 0 ? Math.max(0, Math.min(1, b.value / b.max)) : 0;
          return h('div', { class: 'ma-bar', title: `${b.label}: ${num(Math.round(b.value))} / ${num(Math.round(b.max))}` },
            h('span', { class: 'ma-bl' }, b.label),
            h('span', { class: 'ma-track' }, h('i', { style: `width:${(k * 100).toFixed(1)}%;${b.color ? `background:${b.color}` : ''}` })),
            h('span', { class: 'ma-bv' }, num(Math.round(b.value))));
        }),
        (s.chips || []).length ? h('div', { class: 'ma-chips' }, s.chips.slice(0, 5).map(c => h('span', { class: 'chip' }, c))) : null);
    };
    const st = this.store.state;
    const rep = this.replay;
    const round = this.mode === 'replay' ? this.rp.round : st.round;
    const mid = h('div', { class: 'ma-mid' },
      h('div', { class: 'ma-clock' }, fmtSecs(Math.max(0, t))),
      h('div', { class: 'ma-round' }, `${(this.store.mode && this.store.mode.name) || 'Round'} · R${round || '?'}${rep && rep.level ? ` · LV ${rep.level}` : ''}`));
    add(clear(this.hudEl), panel(0), mid, panel(1));
  }

  feedTicker(t) {
    if (!this.view || !this.view.eventsBetween) return;
    if (this.lastEvT === null || t < this.lastEvT) { this.lastEvT = t; return; }
    let evs = [];
    try { evs = this.view.eventsBetween(this.lastEvT, t) || []; } catch { evs = []; }
    this.lastEvT = t;
    const cfg = this.store.config.fighters;
    for (const e of evs) {
      if (!e || !e.text) continue;
      const col = e.side === 0 || e.side === 1 ? cfg[e.side].color : '#8a92b0';
      this.tickerEl.prepend(h('span', { class: `tk${e.big ? ' big' : ''}`, style: `--c:${col}` }, h('i'), e.text));
    }
    while (this.tickerEl.children.length > 6) this.tickerEl.lastChild.remove();
  }

  // ── overlays ──────────────────────────────────────────────────────────────
  showOverlay(kind, arg) {
    const key = `${kind}:${arg === undefined ? '' : arg}:${this.replay ? 1 : 0}`;
    if (key === this.overlayKey) return;
    const st = this.store.state;
    const vsKey = `${st.matchId}:${st.round}`;
    if (kind === 'vs' && this.vsShown === vsKey && this.overlay.querySelector('.vs-splash')) { this.overlayKey = key; return; }
    this.overlayKey = key;
    const o = clear(this.overlay);
    if (kind === 'count') sfx.count();
    else if (kind === 'go') sfx.fight();
    else if (kind === 'vs' && this.vsShown !== vsKey) sfx.whoosh();
    if (!kind) return;
    if (kind === 'vs') { o.append(this.vsSplash()); this.vsShown = vsKey; }
    else if (kind === 'count') o.append(h('div', { class: 'count' }, h('span', { key: String(arg) }, String(arg))));
    else if (kind === 'go') o.append(h('div', { class: 'count' }, h('span', { class: 'fight' }, st.mode === 'army' ? 'CHARGE!' : st.mode === 'war' ? 'ENGAGE!' : 'GO!')));
    else if (kind === 'preparing') o.append(h('div', { class: 'preparing' }, 'Simulating the round…'));
    else if (kind === 'end') {
      const r = this.replay && this.replay.result;
      if (!r) return;
      const cfg = this.store.config.fighters;
      const w = r.winner === 0 || r.winner === 1 ? cfg[r.winner] : null;
      o.append(h('div', { class: 'big-text' }, h('span', { style: w ? `color:${w.color}` : '' }, w ? `${w.label.toUpperCase()} WINS` : 'DRAW'), r.text ? h('em', null, r.text) : null));
    } else if (kind === 'result') o.append(this.resultCard());
  }

  vsSplash() {
    const st = this.store.state;
    const cfg = this.store.config.fighters;
    const md = this.store.mode || {};
    const final = st.round >= (this.store.config.finalRound || 12);
    const side = (i, cls) => {
      const card = this.store.cards[cfg[i].id] || {};
      const rs = this.replay && this.replay.sides ? this.replay.sides[i] || {} : {};
      const name = rs.name || card.name || cfg[i].label;
      const col = (rs.colors && rs.colors.primary) || (card.colors && card.colors.primary) || cfg[i].color;
      const initials = String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
      return h('div', { class: `vs-side ${cls}`, style: `--c:${cfg[i].color}` },
        h('div', { class: 'vs-ai' }, cfg[i].label),
        h('div', { class: 'vs-img mode-vs-emblem', style: `--ec:${col}` }, h('span', null, initials)),
        h('div', { class: 'vs-name' }, name),
        card.summary ? h('div', { class: 'vs-title' }, card.summary) : null,
        (card.cardLines || []).length ? h('div', { class: 'vs-patch' }, card.cardLines.slice(0, 4).map(l => h('span', { class: 'chip' }, l))) : null);
    };
    const banner = `${final ? 'FINAL ROUND' : `ROUND ${st.round}`} · LEVEL ${st.level || st.round} · ${String(md.name || '').toUpperCase()}`;
    return h('div', { class: 'vs-splash' }, h('div', { class: 'vs-banner' }, banner), side(0, 'left'), h('div', { class: 'vs-mid' }, 'VS'), side(1, 'right'));
  }

  resultCard() {
    const st = this.store.state;
    const cfg = this.store.config.fighters;
    const rep = this.replay;
    if (!rep) return h('div', { class: 'preparing' }, 'Loading the result…');
    const r = rep.result || {};
    const winnerAi = r.winner === 0 || r.winner === 1 ? cfg[r.winner] : null;
    const rec = this.store.match && this.store.match.rounds.find(x => x.round === st.round);
    const rows = (rec && rec.resultRows) || [];
    const isLive = this.mode === 'live' && st.phase === 'round_over';
    const isFinal = st.round >= (this.store.config.finalRound || 12);
    const cell = (v) => (typeof v === 'number' ? num(Math.round(v * 10) / 10) : String(v ?? '—'));
    const cmp = (x, y, better) => (better === 'none' || typeof x !== 'number' || typeof y !== 'number' || x === y ? '' : ((better === 'low' ? x < y : x > y) ? 'better' : 'worse'));
    const fcol = (i) => h('div', { class: `rc-f ${i ? 'right' : ''}${winnerAi && r.winner !== i ? ' loser' : ''}`, style: `--c:${cfg[i].color}` },
      r.winner === i ? h('div', { class: 'crown' }, 'WIN') : null,
      h('div', { class: 'nm' }, (rep.sides && rep.sides[i] && rep.sides[i].name) || cfg[i].label),
      h('div', { class: 'ai' }, cfg[i].label.toUpperCase()));
    return h('div', { class: 'result-card', style: winnerAi ? `--c:${winnerAi.color}` : '' },
      h('div', { class: 'rc-round' }, `Round ${st.round} result · ${(this.store.mode && this.store.mode.name) || ''}`),
      h('div', { class: 'rc-win' }, winnerAi ? `${winnerAi.label.toUpperCase()} WINS` : 'DRAW'),
      h('div', { class: 'rc-how' }, r.text || r.method || ''),
      h('div', { class: 'rc-body' },
        h('div', { class: 'rc-fighters' }, fcol(0), h('div', { class: 'rc-score', title: 'Rounds won' }, `${st.score[cfg[0].id] || 0} – ${st.score[cfg[1].id] || 0}`), fcol(1)),
        rows.length ? h('table', { class: 'rc-table' }, h('tbody', null, rows.slice(0, 9).map(([label, a, b, better]) => h('tr', null,
          h('td', { class: cmp(a, b, better) }, cell(a)), h('td', { class: 'k' }, label), h('td', { class: cmp(b, a, better) }, cell(b)))))) : null),
      isLive && isFinal ? h('div', { class: 'rc-actions' },
        h('button', { class: 'btn primary big', onclick: () => this.api.host('end') }, '🏆 Final statistics', h('kbd', null, 'E')),
        h('button', { class: 'btn ghost big', onclick: () => this.api.openReplay(st.matchId, st.round) }, '↺ Replay', h('kbd', null, 'R'))) : null,
      isLive && !isFinal ? h('div', { class: 'rc-actions' },
        h('button', { class: 'btn primary big', onclick: () => this.api.host('next') }, '▶ Next round', h('kbd', null, 'N')),
        h('button', { class: 'btn big', onclick: () => this.api.host('end', 'End the match and show the final statistics? The AIs will be told to stop.') }, '■ End match & stats', h('kbd', null, 'E')),
        h('button', { class: 'btn ghost big', onclick: () => this.api.openReplay(st.matchId, st.round) }, '↺ Replay', h('kbd', null, 'R'))) : null,
      isLive ? h('div', { class: 'rc-hint' }, isFinal ? 'That was the final round — the match is over. The final statistics open in a moment.' : 'Next round sends each AI its report so it can level up and evolve — the build clock starts again as soon as one of them gets to work.') : null);
  }
}
