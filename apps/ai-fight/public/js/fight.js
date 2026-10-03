// ─────────────────────────────────────────────────────────────────────────────
//  LIVE · the arena: VS splash + countdown, the fight (HUD, ability strips,
//  ticker, announcer callouts), K.O. / time outro, the round result (Next Round
//  / End Match), replays and exhibition fights.
// ─────────────────────────────────────────────────────────────────────────────
import { $, h, clear, add, clamp, fmtSecs, pct, num, n2, iconFor, weaponOf, basicAttack, weaponIcon, FL, F2, HIT, STANCES, STANCE_INFO, simAt, pref, setPref } from './util.js';
import { spriteImg } from './sprites.js';
import { ArenaRenderer } from './renderer.js';
import { sfx, playEvent as sndEvent } from './sound.js'; // sound: playEvent
import { traitChips, patchNotes } from './ui-kit.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export { simAt }; // wall clock → sim time with cinematic holds (util.js, SPEC v4 §3)

const EMOTE = { taunt: '😤', laugh: '😂', salute: '🫡', cheer: '🎉', bow: '🙇', rage: '😡' };
const EMOTE_TEXT = { taunt: 'taunts!', laugh: 'laughs!', salute: 'salutes', cheer: 'cheers!', bow: 'bows', rage: 'rages!' };

/** Round length + ring timings of a replay (v3: 90 s, ring 45→75 s), never hard-coded. */
function timing(rep, rules) {
  const ring = (rep && rep.arena) || {};
  const rr = (rules && rules.ring) || {};
  return {
    roundTime: (rep && rep.roundTime) || (rules && rules.roundTime) || 90,
    shrinkStart: ring.shrinkStart !== undefined ? ring.shrinkStart : (rr.shrinkStart !== undefined ? rr.shrinkStart : 45),
    shrinkEnd: ring.shrinkEnd !== undefined ? ring.shrinkEnd : (rr.shrinkEnd !== undefined ? rr.shrinkEnd : 75),
  };
}

// Announcer moments, computed once per replay: [{t, text, sub, side}]
function computeCallouts(rep, rules) {
  const out = [];
  const tr = rep.tickRate || 30;
  const dur = (rep.frames.length - 1) / tr;
  const maxHp = rep.fighters.map(f => f.maxHp || 1);
  const name = (s) => rep.fighters[s].name;
  const abName = (s, i) => ((rep.fighters[s].abilities[i] || {}).name || 'hit');
  let first = true;
  const chain = [{ n: 0, last: -99, key: null }, { n: 0, last: -99, key: null }];
  for (const e of rep.events) {
    const t = e.t / tr;
    if (e.k === 'hit' && e.dmg > 0) {
      const a = e.a, v = 1 - a;
      if (first) { first = false; out.push({ t, text: 'FIRST BLOOD!', sub: name(a), side: a, pri: 2 }); }
      const c = chain[a];
      const key = `${e.t}:${e.ab}`;
      if (c.key !== key) {
        c.n = t - c.last <= 1.6 ? c.n + 1 : 1;
        c.last = t;
        c.key = key;
        if ([3, 5, 8, 12].includes(c.n)) out.push({ t, text: `${c.n} HIT COMBO!`, sub: name(a), side: a, pri: 1 });
      }
      chain[v].n = 0;
      chain[v].last = -99;
      if ((e.fl & HIT.CRIT) && e.dmg >= Math.max(40, 0.04 * maxHp[v])) out.push({ t, text: 'CRITICAL HIT!', sub: `${abName(a, e.ab)} · ${e.dmg}`, side: a, pri: 3, ooh: true });
      else if (e.dmg >= Math.max(90, 0.1 * maxHp[v])) out.push({ t, text: 'HUGE HIT!', sub: `${abName(a, e.ab)} · ${e.dmg}`, side: a, pri: 3, ooh: true });
    } else if (e.k === 'trait' && e.id === 'second_wind') {
      out.push({ t, text: 'SECOND WIND!', sub: name(e.a), side: e.a, pri: 3 });
    } else if (e.k === 'interrupt') {
      out.push({ t, text: 'INTERRUPTED!', sub: `${name(e.a)}'s ${abName(e.a, e.ab)}`, side: 1 - e.a, pri: 0 });
    } else if (e.k === 'counter' && e.ok) {
      out.push({ t, text: 'COUNTERED!', sub: name(e.a), side: e.a, pri: 2 });
    } else if (e.k === 'trigger') {
      out.push({ t, text: 'TRAP SPRUNG!', sub: `${name(e.a)}'s ${abName(e.a, e.ab)}`, side: e.a, pri: 1 });
    } else if (e.k === 'slam') {
      out.push({ t, text: 'WALL SLAM!', sub: name(e.a), side: 1 - e.a, pri: 2 });
    }
  }
  const low = [false, false];
  for (let i = 0; i < rep.frames.length; i += 3) {
    const fr = rep.frames[i];
    for (const s of [0, 1]) {
      const hp = fr[1 + s][2];
      if (!low[s] && hp > 0 && hp < 0.2 * maxHp[s]) { low[s] = true; out.push({ t: i / tr, text: 'DANGER!', sub: `${name(s)} below 20% HP`, side: s, pri: 2, ooh: true }); }
    }
  }
  const tm = timing(rep, rules);
  if (tm.shrinkStart && dur > tm.shrinkStart + 1) out.push({ t: tm.shrinkStart, text: 'THE RING IS CLOSING!', side: null, pri: 2 });
  if (dur > tm.roundTime - 9) out.push({ t: tm.roundTime - 10, text: 'FINAL 10 SECONDS!', side: null, pri: 2 });
  out.sort((p, q) => p.t - q.t || q.pri - p.pri);
  // Keep them readable: at least ~1.2s apart, higher priority wins, none right before the end.
  const res = [];
  for (const c of out) {
    if (c.t > dur - 0.4) continue;
    const prev = res[res.length - 1];
    if (prev && c.t - prev.t < 1.2) {
      if (c.pri > prev.pri) res[res.length - 1] = c;
      continue;
    }
    res.push(c);
  }
  return res;
}

// Winner flavour for the outro / result: CLUTCH, FLAWLESS…
function winBadge(rep) {
  const r = rep.result;
  if (!r || r.winner === null || r.winner === undefined) return null;
  const w = r.winner;
  const maxHp = rep.fighters[w].maxHp || 1;
  let minHp = maxHp;
  for (let i = 0; i < rep.frames.length; i += 2) minHp = Math.min(minHp, rep.frames[i][1 + w][2]);
  const endPct = r.hpPct[w];
  if (endPct >= 99.5) return 'FLAWLESS VICTORY';
  if (minHp / maxHp < 0.12) return 'CLUTCH WIN';
  if (endPct >= 75) return 'DOMINANT WIN';
  return null;
}

// Status chips shown next to a fighter's name (most important first).
function statusChips(f, spec, v4 = {}) {
  const fl = f.flags || 0;
  const f2 = v4.flags2 || 0;
  const c = [];
  if (fl & FL.KO) c.push(['ko', 'K.O.']);
  if (f2 & F2.ASCENDED) c.push(['awaken', `${(spec.awakening && spec.awakening.name) || 'Ascended'} ${v4.awaken ? `${v4.awaken.toFixed(1)}s` : ''}`.trim()]);
  else if (f2 & F2.AWAKENED) c.push(['awaken', `${(spec.awakening && spec.awakening.name) || 'Awakened'} ${v4.awaken ? `${v4.awaken.toFixed(1)}s` : ''}`.trim()]);
  const ultAb = spec.ultIdx >= 0 ? spec.abilities[spec.ultIdx] : null;
  if (f2 & F2.ULT_CAST) c.push(['ult', `⚡ ${(ultAb && ultAb.name) || 'Ultimate'}`]);
  if (f2 & F2.GOD_CAST) c.push(['ult', '✦ Divine power']);
  if (f2 & F2.TIMESTOPPED) c.push(['stun', 'Time-stopped']);
  if (f2 & F2.AVATAR) c.push(['power', 'Avatar']);
  if (f2 & F2.PHOENIX) c.push(['awaken', 'Phoenix']);
  if (f2 & F2.REVIVED) c.push(['awaken', 'Revived']);
  if (f2 & F2.SWAPPING) c.push(['cast', 'Swapping']);
  if (f2 & F2.MARKED) c.push(['vuln', 'Marked']);
  if (f2 & F2.WARD) c.push(['shield', 'Ward']);
  if (typeof v4.stance === 'number' && v4.stance > 0 && STANCES[v4.stance]) c.push(['stance', `${STANCE_INFO[STANCES[v4.stance]].icon} ${STANCES[v4.stance]}`]);
  if (fl & FL.STUN) c.push(['stun', 'Stunned']);
  if (fl & FL.ROOT) c.push(['root', 'Rooted']);
  if (fl & FL.SILENCE) c.push(['silence', 'Silenced']);
  if (fl & FL.COUNTER) c.push(['counter', 'Countering']);
  if (fl & FL.CHANNEL) c.push(['cast', 'Channeling']);
  else if (fl & FL.CAST && !(f2 & F2.ULT_CAST) && f.castIdx >= 0 && spec.abilities[f.castIdx]) c.push(['cast', spec.abilities[f.castIdx].basic ? 'Winding up' : `▸ ${spec.abilities[f.castIdx].name}`]);
  if (fl & FL.SLOW) c.push(['slow', 'Slowed']);
  if (fl & FL.BURN) c.push(['burn', 'Burning']);
  if (fl & FL.POISON) c.push(['poison', 'Poisoned']);
  if (fl & FL.VULN) c.push(['vuln', 'Vulnerable']);
  if (fl & FL.WEAK) c.push(['weak', 'Weakened']);
  if (fl & FL.SHIELD) c.push(['shield', `Shield ${Math.round(f.sh)}`]);
  if (fl & FL.INVULN) c.push(['inv', 'Invulnerable']);
  if (fl & FL.IMMUNE) c.push(['inv', 'Immune']);
  if (fl & FL.POWER) c.push(['power', 'Power up']);
  if (fl & FL.CRITBUFF) c.push(['power', 'Crit up']);
  if (fl & FL.ARMOR) c.push(['armor', 'Armored']);
  if (fl & FL.TENACITY) c.push(['armor', 'Tenacity']);
  if (fl & FL.SPEED) c.push(['speed', 'Speed up']);
  if (fl & FL.HASTE) c.push(['speed', 'Haste']);
  if (fl & FL.REGEN) c.push(['regen', 'Regen up']);
  if (fl & FL.HOT) c.push(['regen', 'Healing']);
  return c;
}

export class ArenaScreen {
  constructor(api) {
    this.api = api;
    this.canvas = $('#arena-canvas');
    this.renderer = new ArenaRenderer(this.canvas);
    this.overlay = $('#overlay');
    this.fx = $('#fx-layer');
    this.hudEl = $('#hud');
    this.grid = $('#arena-grid');
    this.sides = [$('#hud-side-0'), $('#hud-side-1')];
    this.ticker = $('#ticker');
    this.replayBar = $('#replay-bar');
    this.mode = 'live';
    this.replay = null;
    this.replayKey = null;
    this.loading = null;
    this.overlayKey = null;
    this.soundKey = null;
    this.hud = null;
    this.acc = null;
    this.callouts = [];
    this.calloutShown = null;
    this.sIdx = 0;
    this.sFr = null;
    this.rp = { playing: true, speed: 1, t: 0, last: null, matchId: null, round: null, exhibition: null };
    this.debug = pref('aifight-debug', false);
    this.details = pref('aifight-details', false);
    this.buildToggles();
    this.applyDebug();
    this.applyDetails();
  }

  get store() { return this.api.store; }

  // ── view toggles (bottom bar) ─────────────────────────────────────────────
  buildToggles() {
    const box = $('#arena-toggles');
    if (!box) return;
    this.tgDebug = h('button', { class: 'tgl', type: 'button', title: 'Show what the AIs are thinking: their brains’ debug drawings (B)', onclick: () => this.toggleDebug() }, h('span', { class: 'tgl-box', 'aria-hidden': 'true' }), '🧠 AI thoughts', h('kbd', null, 'B'));
    this.tgDetails = h('button', { class: 'tgl', type: 'button', title: 'Side panels with abilities, traits and fight stats (D)', onclick: () => this.toggleDetails() }, h('span', { class: 'tgl-box', 'aria-hidden': 'true' }), '▤ Details', h('kbd', null, 'D'));
    if (!this.renderer.setOptions) {
      this.tgDebug.disabled = true;
      this.tgDebug.title = 'AI thoughts need the renderer’s debug drawing (not available in this version)';
    }
    clear(box).append(this.tgDebug, this.tgDetails);
  }

  toggleDebug(on = !this.debug) { this.debug = on; setPref('aifight-debug', on); this.applyDebug(); }
  toggleDetails(on = !this.details) { this.details = on; setPref('aifight-details', on); this.applyDetails(); }

  applyDebug() {
    if (this.renderer.setOptions) this.renderer.setOptions({ debug: this.debug });
    if (this.tgDebug) { this.tgDebug.setAttribute('aria-pressed', this.debug ? 'true' : 'false'); this.tgDebug.classList.toggle('on', this.debug); }
  }

  applyDetails() {
    if (this.grid) this.grid.classList.toggle('details-on', this.details);
    if (this.tgDetails) { this.tgDetails.setAttribute('aria-pressed', this.details ? 'true' : 'false'); this.tgDetails.classList.toggle('on', this.details); }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  enter(view) {
    this.mode = view === 'replay' ? 'replay' : 'live';
    this.overlayKey = null;
    this.replayBar.hidden = this.mode !== 'replay';
    if (this.mode === 'live') {
      const st = this.store.state;
      if (this.pendingLive && this.pendingLive.key === `${st.matchId}:${st.round}`) { this.setReplay(this.pendingLive.rep, this.pendingLive.key); }
      this.pendingLive = null;
      if (this.replayKey !== `${st.matchId}:${st.round}`) { this.replay = null; this.clearHud(); }
      this.ensureLiveReplay();
    }
    this.applyDebug();
  }

  refresh(view) {
    if ((view === 'replay') !== (this.mode === 'replay')) this.enter(view);
  }

  leave() { this.overlayKey = null; clear(this.overlay); clear(this.fx); this.calloutShown = null; }

  onState(prev) {
    const st = this.store.state;
    if (!prev || prev.phase !== st.phase || prev.round !== st.round) this.overlayKey = null;
    if (prev && prev.prediction !== st.prediction && this.overlayKey && this.overlayKey.startsWith('result')) this.overlayKey = null;
    if (['countdown', 'fighting', 'round_over'].includes(st.phase)) this.ensureLiveReplay();
  }

  onPresence() { if (this.overlayKey && this.overlayKey.startsWith('result')) this.overlayKey = null; }
  onMatch() { if (this.overlayKey && this.overlayKey.startsWith('result')) this.overlayKey = null; }

  // ── replay loading ────────────────────────────────────────────────────────
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
          if (rep.round === cur.round) {
            if (this.mode === 'live') this.setReplay(rep, key);
            else this.pendingLive = { rep, key };
            break;
          }
        }
      } catch { /* retry */ }
      await sleep(400);
    }
    if (this.loading === key) this.loading = null;
  }

  async openReplay(matchId, round) {
    this.startReplayMode({ matchId, round, exhibition: null });
    try {
      const r = await fetch(`/api/replay/${encodeURIComponent(matchId)}/${round}`);
      if (!r.ok) throw new Error('missing');
      this.setReplay(await r.json(), `replay:${matchId}:${round}`);
      this.buildReplayBar();
    } catch {
      clear(this.overlay).append(h('div', { class: 'preparing' }, 'That replay is not available.'));
    }
  }

  async openExhibition(id) {
    this.startReplayMode({ matchId: null, round: null, exhibition: id });
    try {
      const r = await fetch(`/api/exhibition/${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error('missing');
      this.setReplay(await r.json(), `exhibition:${id}`);
      this.buildReplayBar();
    } catch {
      clear(this.overlay).append(h('div', { class: 'preparing' }, 'That exhibition is not available any more (the server keeps the last 6).'));
    }
  }

  startReplayMode({ matchId, round, exhibition }) {
    this.mode = 'replay';
    this.replayBar.hidden = false;
    clear(this.replayBar).append(h('span', { class: 'rb-tag' }, 'Loading…'));
    this.overlayKey = null;
    clear(this.overlay);
    clear(this.fx);
    this.replay = null;
    this.replayKey = null;
    this.clearHud();
    this.rp = { playing: true, speed: this.rp.speed || 1, t: 0, last: null, matchId, round, exhibition };
  }

  /** Label + colour for side i of the current replay (AIs, or bots in exhibitions). */
  sideInfo(i, rep = this.replay) {
    const cfg = this.store.config.fighters;
    const f = rep && rep.fighters[i];
    const ai = f && cfg.find(c => c.id === f.id);
    if (ai) return { label: ai.label, color: ai.color };
    if (f && rep.kind === 'exhibition') {
      let color = (f.colors && f.colors.primary) || (i ? '#9aa4b1' : '#ffd166');
      if (i === 1) {
        const other = this.sideInfo(0, rep).color;
        if (other.toLowerCase() === color.toLowerCase()) color = (f.colors && f.colors.secondary) || '#9aa4b1';
      }
      return { label: String(f.label || 'Bot').toUpperCase() === 'BOT' ? 'BOT' : f.label, color };
    }
    return { label: cfg[i].label, color: cfg[i].color };
  }

  setReplay(rep, key) {
    this.replay = rep;
    this.replayKey = key;
    this.renderer.setReplay(rep, [0, 1].map(i => this.sideInfo(i, rep).color));
    this.applyDebug();
    this.acc = null;
    this.callouts = computeCallouts(rep, this.store.rules);
    this.badge = winBadge(rep);
    this.calloutShown = null;
    this.sFr = null;
    this.buildHud();
    this.overlayKey = null;
  }

  // ── per frame ─────────────────────────────────────────────────────────────
  tick(now) {
    if (this.mode === 'replay') return this.tickReplay(now);
    const st = this.store.state;
    const sNow = this.api.serverNow();
    const anim = now / 1000;
    if (this.replay && this.replayKey !== `${st.matchId}:${st.round}`) { this.replay = null; this.clearHud(); }
    if (!this.replay && st.theme) this.renderer.setTheme(st.theme.id);
    if (st.phase === 'countdown') {
      const left = (st.countdownEndsAt || sNow) - sNow;
      const elapsed = this.store.rules.countdownMs - left;
      if (elapsed < 3600) this.showOverlay('vs');
      else if (left > 0) this.showOverlay('count', Math.min(3, Math.ceil(left / 1000)));
      else this.showOverlay('preparing');
      if (this.replay) { this.renderer.render(0, anim); this.updateHud(0); } else this.renderer.renderIdle(anim, { cheer: true });
    } else if (st.phase === 'fighting') {
      if (!this.replay) { this.renderer.renderIdle(anim); this.showOverlay('preparing'); this.ensureLiveReplay(); return; }
      // wall clock → sim time, holding still during cinematics (hit-stop / cut-ins), SPEC v4 §3
      const { t, hold } = simAt(this.replay, sNow - st.fightStartsAt);
      this.renderer.render(t, anim, hold);
      this.updateHud(t, hold);
      this.fightFx(t);
      if (t < 0.9 && !hold) this.showOverlay('fight');
      else if (t >= this.renderer.duration) this.showOverlay('end');
      else this.showOverlay(null);
    } else if (st.phase === 'round_over') {
      if (this.replay) {
        const t = st.fightStartsAt ? simAt(this.replay, sNow - st.fightStartsAt).t : this.renderer.duration + 10;
        this.renderer.render(Math.max(t, this.renderer.duration), anim, null);
        this.updateHud(this.renderer.duration);
      } else { this.renderer.renderIdle(anim); this.ensureLiveReplay(); }
      this.showCallout(null);
      this.showOverlay('result');
    } else {
      this.renderer.renderIdle(anim);
    }
  }

  tickReplay(now) {
    const anim = now / 1000;
    if (!this.replay) { this.renderer.renderIdle(anim); return; }
    const rp = this.rp;
    if (rp.last !== null && rp.playing) rp.t += ((now - rp.last) / 1000) * rp.speed;
    rp.last = now;
    // rp.t is watch time (it includes the cinematic holds); simAt maps it to sim time
    const dur = this.renderer.duration;
    const total = this.watchDuration();
    if (rp.t >= total + 1.5) { rp.t = total; rp.playing = false; this.syncReplayBar(); }
    // stopped at the very end: render a moment past it, so hit flashes and the K.O. burst have
    // faded instead of freezing at full brightness
    const atEnd = !rp.playing && rp.t >= total - 1e-6;
    const { t, hold } = simAt(this.replay, (atEnd ? total + 5 : rp.t) * 1000);
    this.renderer.render(t, anim, hold);
    this.updateHud(Math.min(t, dur), hold);
    if (rp.playing) this.fightFx(t); else this.showCallout(null);
    if (t >= dur) this.showOverlay('end'); else this.showOverlay(null);
    if (this.rbRange && document.activeElement !== this.rbRange) this.rbRange.value = String(Math.min(rp.t, total));
    if (this.rbTime) this.rbTime.textContent = `${fmtSecs(Math.min(rp.t, total))} / ${fmtSecs(total)}`;
  }

  /** Length of the fight as watched: sim duration + every cinematic hold. */
  watchDuration() {
    const cin = (this.replay && this.replay.cinematics) || [];
    return this.renderer.duration + cin.reduce((a, c) => a + (c.ms || 0), 0) / 1000;
  }

  togglePlay() {
    const rp = this.rp;
    if (!this.replay) return;
    if (!rp.playing && rp.t >= this.watchDuration()) rp.t = 0;
    rp.playing = !rp.playing;
    this.syncReplayBar();
  }

  // Sounds + announcer callouts that follow the fight clock.
  fightFx(t) {
    const rep = this.replay;
    if (!rep) return;
    const tr = rep.tickRate || 30;
    const fr = Math.min(t, this.renderer.duration) * tr;
    // sounds: only while time moves forward normally (not when scrubbing)
    if (this.sFr === null || fr < this.sFr || fr - this.sFr > tr) {
      const ev = rep.events;
      let lo = 0, hi = ev.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (ev[m].t <= fr) lo = m + 1; else hi = m; }
      this.sIdx = lo;
    } else {
      let n = 0;
      const ev = rep.events;
      while (this.sIdx < ev.length && ev[this.sIdx].t <= fr) {
        const e = ev[this.sIdx++];
        if (n++ > 8) continue;
        this.playEvent(e);
      }
    }
    this.sFr = fr;
    const c = this.callouts.find(x => t >= x.t && t < x.t + 1.35);
    this.showCallout(c || null);
  }

  playEvent(e) {
    sndEvent(e, { replay: this.replay }); // sound: every replay event kind (v2–v4 + g:*) → sound.js playEvent
  }

  showCallout(c) {
    if (c === this.calloutShown) return;
    this.calloutShown = c;
    const old = this.fx.querySelector('.callout');
    if (old) old.remove();
    if (!c) return;
    const color = c.side === null || c.side === undefined ? 'var(--gold)' : this.sideInfo(c.side).color;
    this.fx.append(h('div', { class: 'callout', style: `--c:${color}` }, h('div', { class: 'co-t' }, c.text), c.sub ? h('div', { class: 'co-s' }, c.sub) : null));
    sfx.callout();
    if (c.ooh) sfx.ooh();
  }

  buildReplayBar() {
    const rp = this.rp;
    const dur = this.watchDuration();
    this.rbPlay = h('button', { class: 'btn small', title: 'Play / pause (Space)', onclick: () => this.togglePlay() }, '⏸');
    this.rbRange = h('input', { type: 'range', min: '0', max: String(dur), step: '0.01', value: '0', 'aria-label': 'Replay position' });
    this.rbRange.addEventListener('input', () => { rp.t = Number(this.rbRange.value); this.acc = null; });
    this.rbTime = h('span', { class: 'rb-time' }, `0:00 / ${fmtSecs(dur)}`);
    const speed = h('select', { title: 'Playback speed', 'aria-label': 'Playback speed' }, [0.25, 0.5, 1, 2, 4].map(s => { const o = h('option', { value: String(s) }, `${s}×`); if (s === rp.speed) o.selected = true; return o; }));
    speed.addEventListener('change', () => { rp.speed = Number(speed.value); });
    const rep = this.replay;
    const tag = rp.exhibition ? `Exhibition · LV ${rep.level} · ${rep.fighters[0].name} vs ${rep.fighters[1].name}` : `Replay · Round ${rp.round}${rp.matchId !== this.store.state.matchId ? ' (earlier match)' : ''}`;
    add(clear(this.replayBar),
      h('span', { class: 'rb-tag' }, tag),
      this.rbPlay, this.rbRange, this.rbTime, speed,
      h('button', { class: 'btn ghost small', title: 'Restart', onclick: () => { rp.t = 0; rp.playing = true; this.acc = null; this.syncReplayBar(); } }, '↺'),
      rp.exhibition ? h('button', { class: 'btn small', onclick: () => this.api.openExhibitionPicker() }, '🎮 Another') : null,
      h('button', { class: 'btn small', title: 'Close (Esc)', onclick: () => this.api.closeReplay() }, '✕ Close'),
    );
    this.syncReplayBar();
  }

  syncReplayBar() { if (this.rbPlay) this.rbPlay.textContent = this.rp.playing ? '⏸' : '▶'; }

  // ── overlays ──────────────────────────────────────────────────────────────
  showOverlay(kind, arg) {
    const key = `${kind}:${arg === undefined ? '' : arg}:${this.replay ? 1 : 0}`;
    if (key === this.overlayKey) return;
    // the VS splash slides in once per round: the fight's replay arriving a moment later must not restart it
    const vsKey = `${this.store.state.matchId}:${this.store.state.round}`;
    if (kind === 'vs' && this.vsShown === vsKey && this.overlay.querySelector('.vs-splash')) { this.overlayKey = key; return; }
    this.overlayKey = key;
    const o = clear(this.overlay);
    this.overlaySound(kind, arg);
    if (!kind) return;
    if (kind === 'vs') { o.append(this.vsSplash()); this.vsShown = vsKey; }
    else if (kind === 'count') o.append(h('div', { class: 'count' }, h('span', { key: String(arg) }, String(arg))));
    else if (kind === 'fight') o.append(h('div', { class: 'count' }, h('span', { class: 'fight' }, 'FIGHT!')));
    else if (kind === 'preparing') o.append(h('div', { class: 'preparing' }, 'Simulating the fight…'));
    else if (kind === 'end') {
      const r = this.replay && this.replay.result;
      if (!r) return;
      const text = r.method === 'KO' ? 'K.O.' : r.method === 'DOUBLE KO' ? 'DOUBLE K.O.' : 'TIME!';
      o.append(h('div', { class: 'big-text' },
        h('span', { class: r.method === 'KO' || r.method === 'DOUBLE KO' ? '' : 'time' }, text),
        this.badge ? h('em', null, this.badge) : null));
    } else if (kind === 'result') o.append(this.resultCard());
  }

  // Each overlay moment plays its sound once (re-renders don't replay it).
  overlaySound(kind, arg) {
    const key = `${kind}:${arg}:${this.replayKey}:${this.store.state.phase}`;
    if (key === this.soundKey) return;
    this.soundKey = key;
    if (kind === 'vs') sfx.whoosh();
    else if (kind === 'count') sfx.count();
    else if (kind === 'fight') sfx.fight();
    else if (kind === 'end' && this.replay && this.replay.result && !/KO/.test(this.replay.result.method)) sfx.fight(); // the bell
    else if (kind === 'result' && this.replay && this.mode === 'live') {
      const r = this.replay.result;
      if (r.winner === null || r.winner === undefined) sfx.draw();
      else { sfx.victory(); this.confetti(this.sideInfo(r.winner).color); }
    }
  }

  confetti(color) {
    const old = this.fx.querySelector('.confetti');
    if (old) old.remove();
    const cols = [color, color, '#ffd166', '#ffffff', color];
    const bits = [];
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * 100, delay = Math.random() * 1.4, dur = 2.2 + Math.random() * 2.2;
      const size = Math.random() < 0.3 ? 10 : 6;
      bits.push(h('i', { style: `left:${x.toFixed(1)}%;width:${size}px;height:${size}px;background:${cols[i % cols.length]};animation-delay:${delay.toFixed(2)}s;animation-duration:${dur.toFixed(2)}s;--drift:${Math.round((Math.random() - 0.5) * 160)}px` }));
    }
    const el = h('div', { class: 'confetti' }, bits);
    this.fx.append(el);
    setTimeout(() => el.remove(), 5200);
  }

  fightersForSplash() {
    const cfg = this.store.config.fighters;
    if (this.replay) return this.replay.fighters.map((f, i) => ({ ai: cfg[i], name: f.name, title: f.title, catchphrase: f.catchphrase, sprite: f.sprite, colors: f.colors, traits: f.traits, spec: f }));
    return cfg.map(f => {
      const c = this.store.cards[f.id];
      const spec = c ? c.spec : { name: f.label, colors: {}, abilities: [] };
      return { ai: f, name: spec.name, title: spec.title, catchphrase: spec.catchphrase, sprite: c && c.sprite, colors: spec.colors, traits: spec.traits, spec };
    });
  }

  vsSplash() {
    const st = this.store.state;
    const fs = this.fightersForSplash();
    const prevRound = this.store.match && this.store.match.rounds.find(r => r.round === st.round - 1);
    const side = (f, cls) => {
      const notes = prevRound ? patchNotes(this.store, prevRound.fighters[f.ai.id], f.spec) : null;
      const w = weaponOf(f.spec, this.store.rules);
      return h('div', { class: `vs-side ${cls}`, style: `--c:${f.ai.color}` },
        h('div', { class: 'vs-ai' }, f.ai.label),
        h('div', { class: 'vs-img' }, spriteImg(f.sprite, f.colors, { alt: f.name })),
        h('div', { class: 'vs-name' }, f.name),
        f.title ? h('div', { class: 'vs-title' }, f.title) : null,
        f.catchphrase ? h('div', { class: 'vs-catch' }, `“${f.catchphrase}”`) : null,
        w ? h('div', { class: 'vs-weapon' }, h('span', { class: 'mini-ic' }, weaponIcon(w, basicAttack(f.spec))), w.name) : null,
        f.traits && f.traits.length ? h('div', { class: 'vs-traits' }, traitChips(this.store, f.traits)) : null,
        notes ? h('div', { class: 'vs-patch' }, h('b', null, `Patch notes · vs round ${prevRound.round}`),
          notes.length ? h('div', null, notes.slice(0, 9).map(([k, t]) => h('span', { class: `chip ${k}` }, t)), notes.length > 9 ? h('span', { class: 'chip' }, `+${notes.length - 9} more`) : null)
            : h('div', null, h('span', { class: 'chip' }, 'same body — brain changes only'))) : null);
    };
    const mirror = st.round === 1 && this.store.config.mirrorFirstRound;
    const theme = st.theme ? ` · ${st.theme.name.toUpperCase()}` : '';
    const finalRound = st.round >= (this.store.config.finalRound || 12);
    const banner = `${finalRound ? 'FINAL ROUND' : `ROUND ${st.round}`} · ${mirror ? 'MIRROR MATCH' : `LEVEL ${st.level || 1}`}${theme}`;
    return h('div', { class: 'vs-splash' }, h('div', { class: 'vs-banner' }, banner), side(fs[0], 'left'), h('div', { class: 'vs-mid' }, 'VS'), side(fs[1], 'right'));
  }

  resultCard() {
    const st = this.store.state;
    const cfg = this.store.config.fighters;
    const rep = this.replay;
    if (!rep) return h('div', { class: 'preparing' }, 'Loading the result…');
    const r = rep.result;
    const win = r.winner;
    const winnerAi = win === null || win === undefined ? null : cfg[win];
    const howText = r.method === 'KO' ? `K.O. at ${r.time}s`
      : r.method === 'DECISION' ? `Decision on HP at the bell — ${Math.round(r.hpPct[win])}% vs ${Math.round(r.hpPct[1 - win])}%`
        : r.method === 'DOUBLE KO' ? `Double K.O. at ${r.time}s` : `Draw — ${Math.round(r.hpPct[0])}% vs ${Math.round(r.hpPct[1])}% HP`;
    const sum = rep.summary || [{}, {}];
    const fcol = (i) => {
      const f = rep.fighters[i];
      return h('div', { class: `rc-f ${i ? 'right' : ''}${winnerAi && win !== i ? ' loser' : ''}`, style: `--c:${cfg[i].color}` },
        win === i ? h('div', { class: 'crown' }, 'WIN') : null,
        spriteImg(f.sprite, f.colors, { alt: f.name }),
        h('div', { class: 'nm' }, f.name),
        h('div', { class: 'ai' }, cfg[i].label.toUpperCase()));
    };
    const row = (label, va, vb, better = 'high', fmt = (v) => num(v)) => {
      const cmp = (x, y) => (better === 'none' || x === null || y === null || x === undefined || y === undefined || x === y ? '' : ((better === 'high' ? x > y : x < y) ? 'better' : 'worse'));
      return h('tr', null, h('td', { class: cmp(va, vb) }, fmt(va)), h('td', { class: 'k' }, label), h('td', { class: cmp(vb, va) }, fmt(vb)));
    };
    const hpLeft = [0, 1].map(i => r.hpPct[i] / 100);
    const pres = this.store.presence;
    const listen = cfg.map(f => {
      const on = pres[f.id] && pres[f.id].listening;
      return h('span', { class: on ? 'on' : 'off', title: on ? 'This AI is waiting for your decision' : `This AI is not running its wait command right now — it will pick up your decision the next time it runs "node arena.js wait ${f.id}"` }, `${on ? '●' : '⚠'} ${f.label} ${on ? 'is waiting for your call' : 'is not listening'}`);
    });
    const isLive = this.mode === 'live' && st.phase === 'round_over';
    const isFinal = rep.round >= (this.store.config.finalRound || 12);   // round 12 ends the match by itself
    let predict = null;
    if (isLive && st.prediction) {
      const p = cfg.find(f => f.id === st.prediction);
      const winnerId = winnerAi ? winnerAi.id : null;
      predict = h('div', { class: `rc-predict ${winnerId === st.prediction ? 'hit' : 'miss'}` },
        `🔮 You picked ${p ? p.label : st.prediction} — `, winnerId === st.prediction ? 'called it!' : winnerId ? 'upset!' : 'a draw!');
    }
    const recRound = this.store.match && this.store.match.rounds.find(x => x.round === rep.round);
    const codeMs = (id) => {
      const a = recRound && recRound.activity && recRound.activity[id];
      return a && a.codingMs !== null && a.codingMs !== undefined ? a.codingMs : null;
    };
    const mins = (ms) => (ms === null ? '—' : `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}`);
    const has = (k) => sum[0][k] !== undefined || sum[1][k] !== undefined;
    return h('div', { class: 'result-card', style: winnerAi ? `--c:${winnerAi.color}` : '' },
      h('div', { class: 'rc-round' }, `Round ${rep.round} result${rep.theme ? ` · ${rep.theme.name}` : ''}`),
      h('div', { class: 'rc-win' }, winnerAi ? `${winnerAi.label.toUpperCase()} WINS` : 'DRAW'),
      h('div', { class: 'rc-how' }, this.badge ? h('span', { class: 'rc-badge' }, this.badge) : null, howText),
      predict,
      h('div', { class: 'rc-body' },
        h('div', { class: 'rc-fighters' }, fcol(0),
          h('div', { class: 'rc-score', title: 'Rounds won' }, `${st.score[cfg[0].id] || 0} – ${st.score[cfg[1].id] || 0}`),
          fcol(1)),
        h('table', { class: 'rc-table' }, h('tbody', null,
          row('HP left', hpLeft[0], hpLeft[1], 'high', pct),
          row('Damage dealt', sum[0].dealt, sum[1].dealt),
          row('Accuracy', sum[0].accuracy, sum[1].accuracy, 'high', pct),
          row('Biggest hit', sum[0].biggestHit, sum[1].biggestHit),
          has('crits') ? row('Critical hits', sum[0].crits, sum[1].crits) : null,
          row('Healing', sum[0].healed, sum[1].healed),
          row('Stuns landed', sum[0].stunsLanded, sum[1].stunsLanded),
          recRound ? row('Coding time', codeMs(cfg[0].id), codeMs(cfg[1].id), 'none', mins) : null))),
      isLive && isFinal ? h('div', { class: 'rc-actions' },
        h('button', { class: 'btn primary big', onclick: () => this.api.host('end') }, '🏆 Final statistics', h('kbd', null, 'E')),
        h('button', { class: 'btn ghost big', onclick: () => this.api.openReplay(st.matchId, rep.round) }, '↺ Replay', h('kbd', null, 'R'))) : null,
      isLive && isFinal ? h('div', { class: 'rc-hint' }, 'That was the final round — the match is over. The final statistics open in a moment.') : null,
      isLive && !isFinal ? h('div', { class: 'rc-actions' },
        h('button', { class: 'btn primary big', onclick: () => this.api.host('next') }, '▶ Next round', h('kbd', null, 'N')),
        h('button', { class: 'btn big', onclick: () => this.api.host('end', 'End the match and show the final statistics? The AIs will be told to stop.') }, '■ End match & stats', h('kbd', null, 'E')),
        h('button', { class: 'btn ghost big', onclick: () => this.api.openReplay(st.matchId, rep.round) }, '↺ Replay', h('kbd', null, 'R'))) : null,
      isLive && !isFinal ? h('div', { class: 'rc-hint' }, 'Next round sends each AI its fight report so it can level up and evolve its fighter — the build clock starts again as soon as one of them gets to work. End match shows the final statistics.') : null,
      isLive ? h('div', { class: 'rc-listen' }, listen) : null,
    );
  }

  // ── HUD ───────────────────────────────────────────────────────────────────
  clearHud() {
    clear(this.hudEl);
    for (const s of this.sides) clear(s);
    clear(this.ticker);
    clear(this.fx);
    this.calloutShown = null;
    this.hud = null;
  }

  buildHud() {
    const rep = this.replay;
    this.clearHud();
    const hud = { f: [], sides: [], time: null };
    const tm = timing(rep, this.store.rules);
    rep.fighters.forEach((f, i) => {
      const info = this.sideInfo(i);
      const hpFill = h('div', { class: 'fill' });
      const chip = h('div', { class: 'chip-dmg' });
      const shield = h('div', { class: 'shield' });
      const hpTxt = h('div', { class: 'txt' });
      const enFill = h('div', { class: 'fill' });
      const chips = h('div', { class: 'hud-chips' });
      const recent = h('div', { class: 'hp-recent', 'aria-hidden': 'true' });
      // the ability strip: main weapon attack first (nearest the portrait), the abilities,
      // then the ultimate and the off-hand weapon attack (v4: ultIdx / basicIdx / offIdx)
      const kind = (ab, k) => (k === f.ultIdx || ab.ultimate ? 'ult' : k === f.offIdx || ab.offhand ? 'off' : ab.basic ? 'basic' : 'ab');
      const rank = { basic: 0, ab: 1, ult: 2, off: 3 };
      const order = f.abilities.map((ab, k) => ({ ab, k, kd: kind(ab, k) })).sort((p, q) => rank[p.kd] - rank[q.kd] || p.k - q.k);
      const tiles = order.map(({ ab, k, kd }) => {
        const cd = h('div', { class: 'cd' });
        const cdt = h('div', { class: 'cdt' });
        const what = kd === 'ult' ? 'ULTIMATE — needs a full charge' : kd === 'off' ? `off-hand weapon attack (free) · every ${n2(ab.cooldown)}s` : ab.basic ? `weapon attack (free) · every ${n2(ab.cooldown)}s` : `${ab.type} · ⚡${ab.energy} · ${n2(ab.cooldown)}s`;
        const el = h('div', { class: `abt${ab.basic || kd === 'off' ? ' basic' : ''}${kd === 'ult' ? ' ult' : ''}${kd === 'off' ? ' off' : ''}`, style: `--ac:${ab.color || (f.colors && f.colors.primary) || '#8ab4ff'}`, title: `${ab.name} — ${what}` },
          iconFor(ab, f), cd, cdt);
        return { el, cd, cdt, ab, k, kd, last: {} };
      });
      // v4 meters: ultimate charge and divinity (only for fighters that have them — no layout jumps)
      const hasUlt = !!(f.ultimate || f.abilities.some((ab, k) => kind(ab, k) === 'ult'));
      const hasGod = !!(f.godPowers && f.godPowers.length);
      const ultFill = h('i'), divFill = h('i');
      const ultBar = hasUlt ? h('div', { class: 'meter ult', title: `Ultimate${f.ultimate && f.ultimate.name ? `: ${f.ultimate.name}` : ''} — charges by dealing and taking damage` }, h('span', { class: 'm-lbl' }, 'ULT'), h('span', { class: 'm-bar' }, ultFill)) : null;
      const divBar = hasGod ? h('div', { class: 'meter div', title: `Divinity — godly power${f.godPowers.length > 1 ? 's' : ''}: ${f.godPowers.map(g => g.name || g.id || g).join(', ')}` }, h('span', { class: 'm-lbl' }, 'DIV'), h('span', { class: 'm-bar' }, divFill)) : null;
      const block = h('div', { class: `hud-f${i ? ' right' : ''}`, style: `--c:${info.color}${f.awakening && f.awakening.color ? `;--aw:${f.awakening.color}` : ''}` },
        h('div', { class: 'hud-por' }, spriteImg(f.sprite, f.colors, { alt: f.name })),
        h('div', { class: 'hud-info' },
          h('div', { class: 'hud-row1' }, h('span', { class: 'hud-ai' }, info.label), h('span', { class: 'hud-name', title: f.title || '' }, f.name), chips),
          h('div', { class: 'hpbar' }, chip, hpFill, shield, hpTxt, recent),
          h('div', { class: 'hud-row3' }, h('div', { class: 'enbar', title: 'Energy' }, enFill), h('div', { class: 'hud-abs' }, tiles.map(t => t.el))),
          ultBar || divBar ? h('div', { class: 'hud-meters' }, ultBar, divBar) : null));
      hud.f.push({ block, hpFill, chip, shield, hpTxt, enFill, chips, recent, tiles, ultFill, divFill, ultBar, divBar, lastChips: null, maxHp: f.maxHp, maxEnergy: f.maxEnergy, last: {}, d: null });
      if (i === 0) this.hudEl.append(block);
      else {
        hud.time = h('div', { class: 'hud-time' }, fmtSecs(tm.roundTime));
        const roundLabel = rep.kind === 'test' ? 'SPARRING' : rep.kind === 'exhibition' ? `EXHIBITION · LV ${rep.level}` : `ROUND ${rep.round}${rep.level ? ` · LV ${rep.level}` : ''}`;
        hud.round = h('div', { class: 'hud-round' }, roundLabel);
        hud.ring = h('div', { class: 'hud-ring' });
        this.hudEl.append(h('div', { class: 'hud-mid' }, hud.time, hud.round, hud.ring), block);
      }
      // optional detail panel
      const rows = f.abilities.map((ab, k) => {
        const cd = h('div', { class: 'cd' });
        const cdt = h('div', { class: 'cdt' });
        const rowEl = h('div', { class: `hs-ab${ab.basic ? ' basic' : ''}`, style: `--ac:${ab.color || (f.colors && f.colors.primary) || '#8ab4ff'}` },
          h('div', { class: 'ic' }, iconFor(ab, f), cd, cdt),
          h('div', null, h('div', { class: 'nm' }, ab.name), h('div', { class: 'sub' }, ab.basic ? `weapon · free · ${n2(ab.cooldown)}s` : `${ab.type} · ⚡${ab.energy} · ${n2(ab.cooldown)}s`)));
        return { rowEl, cd, cdt, ab, k, last: {} };
      });
      rows.sort((p, q) => (q.ab.basic ? 1 : 0) - (p.ab.basic ? 1 : 0));
      const dealt = h('b', null, '0'), acc = h('b', null, '—'), casts = h('b', null, '0');
      const side = this.sides[i];
      side.style.setProperty('--c', info.color);
      add(side,
        h('div', { class: 'hs-block' }, h('div', { class: 'hs-title' }, h('span', null, info.label), h('span', null, 'abilities')), rows.map(r => r.rowEl)),
        f.traits && f.traits.length ? h('div', { class: 'hs-block' }, h('div', { class: 'hs-title' }, 'Traits'), h('div', { class: 'chips' }, traitChips(this.store, f.traits))) : null,
        h('div', { class: 'hs-block' }, h('div', { class: 'hs-title' }, 'This fight'),
          h('div', { class: 'hs-stat' }, h('span', null, 'Damage dealt'), dealt),
          h('div', { class: 'hs-stat' }, h('span', null, 'Accuracy'), acc),
          h('div', { class: 'hs-stat' }, h('span', null, 'Abilities used'), casts)),
      );
      hud.sides.push({ rows, dealt, acc, casts });
    });
    this.hud = hud;
  }

  accumulate(fr) {
    const rep = this.replay;
    if (!this.acc || fr < this.acc.fr) this.acc = { k: 0, fr: 0, dealt: [0, 0], hits: [0, 0], fired: [0, 0], casts: [0, 0], ticker: [], changed: true };
    const acc = this.acc;
    const ev = rep.events;
    while (acc.k < ev.length && ev[acc.k].t <= fr) {
      const e = ev[acc.k++];
      const f = rep.fighters[e.a];
      if (!f) continue;
      const ab = e.ab !== undefined ? f.abilities[e.ab] : null;
      if (e.k === 'hit') { acc.dealt[e.a] += e.dmg; acc.hits[e.a]++; }
      else if (e.k === 'dot') acc.dealt[e.a] += e.dmg;
      else if (e.k === 'cast' && !(ab && ab.basic)) acc.casts[e.a]++;
      if (e.k === 'fire' && ab) acc.fired[e.a] += ab.count || 1;
      else if (e.k === 'swing' || e.k === 'burst') acc.fired[e.a]++;
      else if (e.k === 'dash' && ab && (ab.damage > 0 || Object.keys(ab.effects || {}).length)) acc.fired[e.a]++;
      const line = this.tickerLine(e, rep);
      if (line) {
        const top = acc.ticker[0];
        if (top && top.text === line.text) top.count = (top.count || 1) + 1;
        else { acc.ticker.unshift(line); if (acc.ticker.length > 6) acc.ticker.pop(); }
      }
      acc.changed = true;
    }
    acc.fr = fr;
    return acc;
  }

  tickerLine(e, rep) {
    const f = rep.fighters[e.a];
    const other = rep.fighters[1 - e.a];
    const ab = e.ab !== undefined ? f.abilities[e.ab] : null;
    const color = this.sideInfo(e.a).color;
    const mk = (text, c = color) => ({ text, color: c, t: e.t });
    switch (e.k) {
      case 'hit':
        if (e.fl & HIT.STUN) return mk(`${f.name}'s ${ab ? ab.name : 'attack'} STUNS ${other.name}!`);
        if (e.fl & HIT.CRIT) return mk(`CRIT! ${f.name}'s ${ab ? ab.name : 'hit'} for ${e.dmg}`);
        if (e.fl & HIT.ROOT) return mk(`${f.name} roots ${other.name}`);
        if (e.fl & HIT.SILENCE) return mk(`${f.name} silences ${other.name}`);
        if (e.dmg >= 45) return mk(`${f.name} › ${ab ? ab.name : 'hit'} for ${e.dmg}`);
        return null;
      case 'heal': return mk(`${f.name} heals ${e.v}${e.over ? ` over ${e.over}s` : ''}`);
      case 'shield': return mk(`${f.name} raises ${ab ? ab.name : 'a shield'} (${e.v})`);
      case 'buff': return mk(`${f.name} powers up: +${e.v}% ${e.stat}`);
      case 'zone': return mk(`${f.name} casts ${ab ? ab.name : 'a zone'}`);
      case 'evade': return mk(`${f.name} evades!`);
      case 'interrupt': return mk(`${f.name}'s ${ab ? ab.name : 'cast'} was interrupted`);
      case 'counter': return e.ok ? mk(`${f.name} COUNTERS!`) : null;
      case 'trap': return mk(`${f.name} sets ${ab ? ab.name : 'a trap'}`);
      case 'trigger': return mk(`${other.name} steps on ${f.name}'s ${ab ? ab.name : 'trap'}!`);
      case 'beam': return mk(`${f.name} channels ${ab ? ab.name : 'a beam'}`);
      case 'cleanse': return mk(`${f.name} cleanses!`);
      case 'slam': return mk(`${f.name} is slammed into an obstacle!`, this.sideInfo(1 - e.a).color);
      case 'meteor': return mk(`${f.name} calls down ${ab ? ab.name : 'a meteor'}`);
      case 'say': return mk(`“${e.text}” — ${f.name}`);
      case 'ko': return mk(`${f.name} is KNOCKED OUT!`, '#ff5d5d');
      // v4
      case 'emote': return mk(`${EMOTE[e.v] || '💬'} ${f.name} ${EMOTE_TEXT[e.v] || String(e.v || 'emotes')}`);
      case 'stance': return STANCES[e.v] || typeof e.v === 'string' ? mk(`${f.name} switches to ${typeof e.v === 'string' ? e.v : STANCES[e.v]} stance`) : null;
      case 'ult': return mk(`${f.name} unleashes the ULTIMATE${ab ? `: ${ab.name}` : f.ultimate && f.ultimate.name ? `: ${f.ultimate.name}` : ''}!`, '#ffd166');
      case 'ultready': return mk(`${f.name}'s ultimate is charged`);
      case 'divready': return mk(`${f.name} is filled with divinity`, '#fff3c4');
      case 'awaken': return mk(e.v === 'ascend' ? `${f.name} ASCENDS!` : `${f.name} AWAKENS${f.awakening && f.awakening.name ? `: ${f.awakening.name}` : ''}!`, (f.awakening && f.awakening.color) || '#ffd166');
      case 'swap': return mk(`${f.name} swaps to ${e.w === 1 ? ((f.offhand && f.offhand.name) || 'the off-hand weapon') : ((f.weapon && f.weapon.name) || 'the main weapon')}`);
      case 'turret': return mk(`${f.name} deploys ${ab ? ab.name : 'a turret'}`);
      case 'relic': { const r = (f.relics || []).find(x => x.id === e.id || x === e.id); return mk(`${f.name}'s ${(r && r.name) || String(e.id || 'relic').replace(/_/g, ' ')} triggers!`); }
      case 'revive': return mk(`${f.name} REVIVES!`, '#ffd166');
      case 'god': { const g = (f.godPowers || []).find(x => x.id === e.id || x === e.id); return mk(`${f.name} invokes ${(g && g.name) || String(e.id || 'a godly power').replace(/_/g, ' ')}!`, (g && g.color) || '#fff3c4'); }
      default: return null;
    }
  }

  updateHud(t) {
    if (!this.hud || !this.replay) return;
    const s = this.renderer.stateAt(t);
    if (!s) return;
    const rep = this.replay;
    const acc = this.accumulate(s.fr);
    const tr = rep.tickRate || 30;
    // Bars are tweened (no jumps) unless the position jumped (seek / new replay).
    const now = performance.now();
    const dt = this.hudNow ? Math.min(0.1, (now - this.hudNow) / 1000) : 0;
    const seek = this.hudFr === undefined || Math.abs(s.fr - this.hudFr) > tr * 1.5;
    this.hudNow = now;
    this.hudFr = s.fr;
    const ease = (rate) => (seek ? 1 : 1 - Math.exp(-dt * rate));
    const setW = (el, p, prev) => { if (prev === undefined || Math.abs(prev - p) > 0.04) el.style.width = `${p}%`; return p; };
    // raw v4 fighter fields (the renderer's state keeps the v2/v3 ones)
    const last = rep.frames.length - 1;
    const f0 = rep.frames[Math.min(last, s.i)], f1 = rep.frames[Math.min(last, s.i + 1)];
    const a = Math.max(0, Math.min(1, s.fr - s.i));
    s.fighters.forEach((f, i) => {
      const H = this.hud.f[i];
      const spec = rep.fighters[i];
      const raw = (f0 && f0[1 + i]) || [], raw1 = (f1 && f1[1 + i]) || raw;
      const v4 = { flags2: raw[12] || 0, stance: raw[13], ult: raw[14], div: raw[15], weaponIdx: raw[16] || 0, awaken: (raw[17] || 0) / 10 };
      if (typeof raw[14] === 'number' && typeof raw1[14] === 'number') v4.ult = raw[14] + (raw1[14] - raw[14]) * a;
      if (typeof raw[15] === 'number' && typeof raw1[15] === 'number') v4.div = raw[15] + (raw1[15] - raw[15]) * a;
      const hpP = clamp(f.hp / H.maxHp, 0, 1) * 100;
      const shP = clamp(f.sh / H.maxHp, 0, 1) * 100;
      const enP = clamp(f.en / H.maxEnergy, 0, 1) * 100;
      if (!H.d || seek) H.d = { hp: hpP, chip: hpP, sh: shP, en: enP, ult: v4.ult || 0, div: v4.div || 0, target: hpP, dropAt: 0, recent: 0, recentAt: 0, hpAbs: f.hp };
      const D = H.d;
      // recent damage: "−N" tag + a lighter chip that lingers, then drains
      if (!seek && f.hp < D.hpAbs - 0.5) { D.recent = (now - D.recentAt < 1300 ? D.recent : 0) + (D.hpAbs - f.hp); D.recentAt = now; D.dropAt = now; }
      D.hpAbs = f.hp;
      D.hp += (hpP - D.hp) * ease(22);
      if (hpP >= D.chip) D.chip = hpP;
      else if (now - D.dropAt > 550) D.chip += (hpP - D.chip) * ease(4.5);
      D.sh += (shP - D.sh) * ease(14);
      D.en += (enP - D.en) * ease(12);
      H.w = H.w || {};
      H.w.hp = setW(H.hpFill, D.hp, H.w.hp);
      H.w.chip = setW(H.chip, Math.max(D.chip, D.hp), H.w.chip);
      H.w.sh = setW(H.shield, D.sh, H.w.sh);
      H.w.en = setW(H.enFill, D.en, H.w.en);
      if (!H.w.side) { H.shield.style.left = i ? 'auto' : '0'; H.shield.style.right = i ? '0' : 'auto'; if (i) H.hpTxt.style.flexDirection = 'row-reverse'; H.w.side = true; }
      const key = `${Math.round(f.hp)}|${Math.round(f.sh)}`;
      if (key !== H.last.key) {
        H.last.key = key;
        clear(H.hpTxt).append(h('span', null, `${Math.max(0, Math.round(f.hp))} / ${H.maxHp}`), h('span', null, f.sh > 0.5 ? `+${Math.round(f.sh)} shield` : ''));
        H.hpFill.parentElement.classList.toggle('low', hpP > 0 && hpP < 20);
      }
      const showRecent = D.recent >= 1 && now - D.recentAt < 1300;
      const rtxt = showRecent ? `−${Math.round(D.recent)}` : '';
      if (H.recent.textContent !== rtxt) { H.recent.textContent = rtxt; if (rtxt) { H.recent.classList.remove('pop'); void H.recent.offsetWidth; H.recent.classList.add('pop'); } }
      // v4 meters
      if (H.ultBar && typeof v4.ult === 'number') {
        D.ult += (v4.ult - D.ult) * ease(10);
        H.w.ult = setW(H.ultFill, clamp(D.ult, 0, 100), H.w.ult);
        H.ultBar.classList.toggle('ready', !!(v4.flags2 & F2.ULT_READY) || v4.ult >= 99.5);
      }
      if (H.divBar && typeof v4.div === 'number') {
        D.div += (v4.div - D.div) * ease(10);
        H.w.div = setW(H.divFill, clamp(D.div, 0, 100), H.w.div);
        H.divBar.classList.toggle('ready', !!(v4.flags2 & F2.GOD_READY) || v4.div >= 99.5);
      }
      const awake = !!(v4.flags2 & (F2.AWAKENED | F2.ASCENDED));
      H.block.classList.toggle('awakened', awake);
      H.block.classList.toggle('ascended', !!(v4.flags2 & F2.ASCENDED));
      const upd = (row) => {
        const cd = (f.cds && f.cds[row.k] ? f.cds[row.k] : 0) / 10;
        const frac = row.ab.cooldown ? clamp(cd / row.ab.cooldown, 0, 1) : 0;
        const casting = f.castIdx === row.k;
        const poor = !row.ab.basic && row.kd !== 'ult' && row.kd !== 'off' && f.en < row.ab.energy;
        // the ultimate shows its charge; the weapon not in hand is dimmed
        const charge = row.kd === 'ult' && typeof v4.ult === 'number' ? clamp(v4.ult, 0, 100) : null;
        const idle = (row.kd === 'off' && v4.weaponIdx !== 1) || (row.kd === 'basic' && spec.offIdx !== undefined && spec.offIdx !== null && v4.weaponIdx === 1);
        const rk = `${Math.round(frac * 50)}|${casting}|${poor}|${cd > 0 ? cd.toFixed(1) : ''}|${charge === null ? '' : Math.round(charge / 2)}|${idle}`;
        if (rk === row.last.k) return;
        row.last.k = rk;
        const el = row.el || row.rowEl;
        if (charge !== null) {
          row.cd.style.setProperty('--p', String(100 - charge));
          row.cdt.textContent = charge < 99.5 ? `${Math.floor(charge)}` : '';
          el.classList.toggle('cooling', charge < 99.5);
          el.classList.toggle('ready', charge >= 99.5);
        } else {
          row.cd.style.setProperty('--p', String(frac * 100));
          row.cdt.textContent = cd > 0.05 ? (cd >= 10 ? String(Math.ceil(cd)) : cd.toFixed(1)) : '';
          el.classList.toggle('cooling', cd > 0.05);
        }
        el.classList.toggle('casting', casting);
        el.classList.toggle('poor', poor && cd <= 0.05);
        el.classList.toggle('idle', idle);
      };
      H.tiles.forEach(upd);
      if (this.details) this.hud.sides[i].rows.forEach(upd);
      const chips = statusChips(f, spec, v4);
      const ck = chips.map(c => c[1]).join('|');
      if (ck !== H.lastChips) {
        H.lastChips = ck;
        clear(H.chips).append(...chips.slice(0, 4).map(([c, txt]) => h('span', { class: `sc ${c}` }, txt)), chips.length > 4 ? h('span', { class: 'sc more', title: chips.slice(4).map(c => c[1]).join(', ') }, `+${chips.length - 4}`) : '');
      }
      if (acc.changed) {
        const side = this.hud.sides[i];
        side.dealt.textContent = num(acc.dealt[i]);
        side.acc.textContent = acc.fired[i] ? pct(Math.min(1, acc.hits[i] / acc.fired[i])) : '—';
        side.casts.textContent = String(acc.casts[i]);
      }
    });
    const tm = timing(rep, this.store.rules);
    const left = tm.roundTime - s.fr / tr;
    const tt = fmtSecs(Math.ceil(Math.max(0, left)));
    if (this.hud.time.textContent !== tt) {
      this.hud.time.textContent = tt;
      this.hud.time.classList.toggle('low', left <= 10);
    }
    const tsec = s.fr / tr;
    const ring = tsec >= tm.shrinkStart && tsec < tm.shrinkEnd ? 'THE RING IS CLOSING' : tsec >= tm.shrinkStart - 3 && tsec < tm.shrinkStart ? `RING CLOSES IN ${Math.ceil(tm.shrinkStart - tsec)}` : tsec >= tm.shrinkEnd ? 'FINAL RING' : '';
    if (this.hud.ring.textContent !== ring) this.hud.ring.textContent = ring;
    // the ticker is rebuilt at most ~4× a second so bursts of events don't make it flicker
    if (acc.changed && (seek || now - (this.tickerAt || 0) > 260)) {
      acc.changed = false;
      this.tickerAt = now;
      clear(this.ticker).append(...acc.ticker.map(l => h('span', { class: 'tk', style: `--c:${l.color}` }, h('i'), l.count > 1 ? `${l.text} ×${l.count}` : l.text)));
    }
  }
}
