// ─────────────────────────────────────────────────────────────────────────────
//  Sound: music + sound effects (v5).
//  • Samples and music from Epidemic Sound live in /audio (see /audio/CREDITS.md).
//    Anything without a sample (or before samples load) falls back to tones
//    synthesized with WebAudio.
//  • Mixing: every effect runs through a glue compressor and a limiter; heavy
//    moments briefly duck the music (a WebAudio bus) so they punch through.
//    Big hits are layered: transient + body + sub boom + tail.
//  • Music: every arena (map) has its own songs, plus menu / build / match-over
//    sets and the army / business modes. musicTrackFor() picks one:
//    index = (matchNumber − 1 + earlier rounds of this match on the same map) mod n,
//    and a per-match memory makes sure no two rounds of a match share a song.
//  • playEvent(e, ctx) → one call per replay event (every kind incl. g:*),
//    modeEvent(mode, e) → army / business mode events, ui(name, arg) → interface.
//  • Deterministic: variants rotate and pitch offsets hash a counter (no Math.random).
//  • Browsers only allow audio after a click / key press, so unlock() is called
//    from the first user gesture. Mute / music / volume are remembered.
//  • soundStatus() / verifyAudio() report what loaded (used by the tests).
// ─────────────────────────────────────────────────────────────────────────────

let ctx = null;
let master = null;   // user volume + mute → limiter → speakers
let sfxBus = null;   // every effect → glue compressor → master
let musicBus = null; // streamed music (ducking) → speakers
let muted = false;
let musicOn = true;
let volume = 0.6;
try {
  muted = localStorage.getItem('aifight-muted') === '1';
  musicOn = localStorage.getItem('aifight-music') !== '0';
  const v = localStorage.getItem('aifight-volume');
  if (v !== null && Number.isFinite(Number(v))) volume = Math.max(0, Math.min(1, Number(v)));
} catch { /* storage blocked: defaults */ }

function gainValue() { return muted ? 0 : volume * 0.55; }
function setParams(node, p) { for (const [k, v] of Object.entries(p)) if (node[k]) node[k].value = v; }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    const limiter = ctx.createDynamicsCompressor();
    setParams(limiter, { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.15 });
    limiter.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = gainValue();
    master.connect(limiter);
    // glue: a slow-ish attack lets the transients through (punch), the body gets squeezed (weight)
    const glue = ctx.createDynamicsCompressor();
    setParams(glue, { threshold: -22, knee: 10, ratio: 3.5, attack: 0.012, release: 0.25 });
    const makeup = ctx.createGain();
    makeup.gain.value = 1.35;
    sfxBus = ctx.createGain();
    sfxBus.connect(glue);
    glue.connect(makeup);
    makeup.connect(master);
    musicBus = ctx.createGain();
    musicBus.connect(ctx.destination);
  } catch { ctx = null; }
  return ctx;
}

// ── samples ──────────────────────────────────────────────────────────────────
const FILES = {
  // combat core (variants rotate)
  hit1: 'sfx-hit-1', hit2: 'sfx-hit-2', hit3: 'sfx-hit-3', hit4: 'sfx-hit-4',
  slash1: 'sfx-slash-1', slash2: 'sfx-slash-2', slash3: 'sfx-slash-3',
  whoosh1: 'sfx-whoosh-1', whoosh2: 'sfx-whoosh-2', whoosh3: 'sfx-whoosh-3', whip: 'sfx-whip', swipe: 'sfx-swipe',
  heavy1: 'sfx-heavy-1', heavy2: 'sfx-heavy-2', heavyHit: 'sfx-heavy-hit',
  koHit: 'sfx-ko-hit', bodyfall: 'sfx-bodyfall', crit: 'sfx-crit', block: 'sfx-block', parry: 'sfx-parry', clang: 'sfx-clang',
  unsheathe: 'sfx-unsheathe', bow: 'sfx-bow', gun: 'sfx-gun', cast: 'sfx-cast', magicCast: 'sfx-magic-cast',
  explosion1: 'sfx-explosion-1', explosion2: 'sfx-explosion-2', bomb: 'sfx-bomb', boom: 'sfx-boom',
  // abilities
  fireball: 'sfx-fireball', teleport: 'sfx-teleport', shield: 'sfx-shield', beam: 'sfx-beam', trap: 'sfx-trap', turret: 'sfx-turret',
  chime: 'sfx-chime', holy: 'sfx-holy', heal: 'sfx-heal', healMagic: 'sfx-heal-magic', powerup: 'sfx-powerup', awaken: 'sfx-awaken',
  // interface + stingers
  uiClick: 'sfx-ui-click', uiOpen: 'sfx-ui-open', uiConfirm: 'sfx-ui-confirm', ping: 'sfx-ping', bell: 'sfx-bell', coin: 'sfx-coin',
  levelup: 'sfx-levelup', alarm: 'sfx-alarm', fall: 'sfx-fall', fanfare: 'sfx-fanfare', jingleWin: 'sfx-jingle-win', jingleLose: 'sfx-jingle-lose',
  gong: 'sfx-gong', arp: 'sfx-arp', victorySting: 'sfx-victory-sting', defeatSting: 'sfx-defeat-sting',
  // cinematic
  riserShort: 'sfx-riser-short', riserLong: 'sfx-riser-long', release: 'sfx-release', subDrop: 'sfx-sub-drop', impactCine: 'sfx-impact-cine',
  thunder: 'sfx-thunder', choir: 'sfx-choir', epicHit: 'sfx-epic-hit', braam: 'sfx-braam',
  // godly power signatures
  godTimestop: 'sfx-god-timestop', godJudgment: 'sfx-god-judgment', godBlackhole: 'sfx-god-blackhole', godMeteor: 'sfx-god-meteor',
  godThunder: 'sfx-god-thunder', godAvatar: 'sfx-god-avatar', godPhoenix: 'sfx-god-phoenix', godWorldtree: 'sfx-god-worldtree',
  // crowd, voices, announcer
  cheer: 'sfx-cheer', cheerSmall: 'sfx-cheer-small', ooh: 'sfx-ooh', groan: 'sfx-crowd-groan',
  crowdRoar: 'sfx-crowd-roar', crowdBoo: 'sfx-crowd-boo', crowdApplause: 'sfx-crowd-applause', crowdChant: 'sfx-crowd-chant',
  laugh: 'sfx-laugh', shout: 'sfx-shout',
  // announcer: Epidemic only has "Round 1" (anime style). announce() also knows annFight / annKo /
  // annFinal / annVictory: drop sfx-ann-<fight|ko|final|victory>.mp3 in /audio and list them here.
  annRound: 'sfx-ann-round',
  // army mode
  armyHorn: 'sfx-army-horn', armyMarch: 'sfx-army-march', armyClash: 'sfx-army-clash', armyVolley: 'sfx-army-volley',
  armyCharge: 'sfx-army-charge', armySiege: 'sfx-army-siege', armyDeath1: 'sfx-army-death-1', armyDeath2: 'sfx-army-death-2',
  armyRout: 'sfx-army-rout', armyBattlecry: 'sfx-army-battlecry', armyVictory: 'sfx-army-victory',
  // business mode
  bizBell: 'sfx-biz-bell', bizSale: 'sfx-biz-sale', bizCash: 'sfx-biz-cash', bizOpen: 'sfx-biz-open', bizClose: 'sfx-biz-close',
  bizLaunch: 'sfx-biz-launch', bizPrice: 'sfx-biz-price', bizHire: 'sfx-biz-hire', bizMarketing: 'sfx-biz-marketing',
  bizMilestone: 'sfx-biz-milestone', bizNews: 'sfx-biz-news', bizBankrupt: 'sfx-biz-bankrupt', bizVictory: 'sfx-biz-victory',
  // modern warfare mode
  warRifle: 'sfx-war-rifle', warMg: 'sfx-war-mg', warCannon: 'sfx-war-cannon', warArtillery: 'sfx-war-artillery',
  warRocket: 'sfx-war-rocket', warCruise: 'sfx-war-cruise', warJet: 'sfx-war-jet', warSiren: 'sfx-war-siren',
  warExplosion: 'sfx-war-explosion', warBigBoom: 'sfx-war-bigboom',
};
const SAMPLES = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, `/audio/${f}.mp3`]));
// Every file is loudness-normalised the same way (RMS −16 dBFS, peaks ≤ −1 dBFS). Interface and
// small cues were quiet recordings before that: these trims keep them subtle in the mix.
const TRIM = {
  uiClick: 0.25, uiOpen: 0.17, uiConfirm: 0.35, ping: 0.1, levelup: 0.4, alarm: 0.4, fall: 0.4, jingleWin: 0.3,
  jingleLose: 0.55, fanfare: 0.35, arp: 0.2, chime: 0.28, coin: 0.75, teleport: 0.35, holy: 0.4, cast: 0.4,
  cheerSmall: 0.4, gun: 0.5, shout: 0.45, powerup: 0.45, shield: 0.45, bow: 0.7, beam: 0.6, bell: 0.6, bomb: 0.6,
  epicHit: 0.55, heavyHit: 0.65, defeatSting: 0.5, heal: 0.7, ooh: 0.65, cheer: 0.6, victorySting: 0.75, awaken: 1.5,
  groan: 0.5, annRound: 0.8, bizPrice: 0.7, bizHire: 0.8,
  warRifle: 0.5, warSiren: 0.45, warExplosion: 0.8, warCruise: 0.8,
};
// where a riser peaks (s): the charge-up is aligned so the peak lands on the release
const RISER_PEAK = { riserShort: 1.07, riserLong: 2.9 };
const buffers = {};
const failed = {};
let samplesRequested = false;

// Fighter-mode sounds first, the army / business sets last; 6 downloads at a time.
function loadSamples() {
  if (samplesRequested || !ctx) return;
  samplesRequested = true;
  const late = (n) => (/^(army|biz)/.test(n) ? 1 : 0);
  const names = Object.keys(SAMPLES).sort((a, b) => late(a) - late(b));
  let i = 0;
  const next = () => {
    if (i >= names.length) return;
    const name = names[i++];
    fetch(SAMPLES[name])
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(ab => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
      .then(buf => { buffers[name] = buf; })
      .catch(err => { failed[name] = String((err && err.message) || err || 'decode error'); })
      .finally(next);
  };
  for (let k = 0; k < 6; k++) next();
}

// Busy fights: never more than MAX_VOICES samples at once (prio >= 2 always plays).
const MAX_VOICES = 26;
let voices = 0;

/**
 * Play a sample into the effects bus. Returns a voice handle ({ stop(fadeSec) }), `true` if it was
 * swallowed because the mix is full, or false if it isn't loaded (so the caller can synthesize).
 */
function sample(name, { vol = 1, rate = 1, at = 0, duration = null, fade = 0.3, prio = 1, offset = 0, pan = 0, lp = 0 } = {}) {
  const c = live();
  const buf = buffers[name];
  if (!c || !buf) return false;
  if (voices >= MAX_VOICES && prio < 2) return true; // swallowed: too busy
  const t = c.currentTime + Math.max(0, at);
  const s = c.createBufferSource();
  s.buffer = buf;
  s.playbackRate.value = rate;
  const g = c.createGain();
  vol *= TRIM[name] || 1;
  g.gain.setValueAtTime(vol, t);
  if (duration) {
    g.gain.setValueAtTime(vol, t + Math.max(0, duration - fade));
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  }
  let node = s;
  if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
  node.connect(g);
  let out = g;
  if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); out = p; }
  out.connect(sfxBus);
  voices++;
  s.onended = () => { voices = Math.max(0, voices - 1); };
  s.start(t, clamp(offset, 0, Math.max(0, buf.duration - 0.02)));
  if (duration) s.stop(t + duration + 0.05);
  return {
    stop(f = 0.1) {
      try {
        const n = c.currentTime;
        g.gain.cancelScheduledValues(n);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), n);
        g.gain.exponentialRampToValueAtTime(0.0001, n + f);
        s.stop(n + f + 0.02);
      } catch { /* already stopped */ }
    },
  };
}
const S = sample;

// Deterministic per-sound variation: the n-th play of `key` always gets the same
// small pitch/volume offset, so repeats never sound identical (no Math.random).
const varyN = {};
function vary(key, spread = 0.07) {
  const n = (varyN[key] = ((varyN[key] || 0) + 1) % 1009);
  const h = Math.sin(n * 12.9898 + key.length * 78.233) * 43758.5453;
  return 1 - spread + (h - Math.floor(h)) * spread * 2;
}
// Deterministic pick among the loaded variants of a sound: a hashed counter (not a plain cycle),
// never the same variant twice in a row.
const rotN = {};
const rotLast = {};
function rot(key, names) {
  const avail = names.filter(n => buffers[n]);
  if (!avail.length) return names[0];
  if (avail.length === 1) return avail[0];
  const n = (rotN[key] = ((rotN[key] || 0) + 1) % 9973);
  const h = Math.sin(n * 91.345 + key.length * 17.17) * 43758.5453;
  let i = Math.floor((h - Math.floor(h)) * avail.length) % avail.length;
  if (avail[i] === rotLast[key]) i = (i + 1) % avail.length;
  rotLast[key] = avail[i];
  return avail[i];
}

const HITS = ['hit1', 'hit2', 'hit3', 'hit4'];
const SLASHES = ['slash1', 'slash2', 'slash3'];
const WHOOSHES = ['whoosh1', 'whoosh2', 'whoosh3'];
const HEAVIES = ['heavy1', 'heavy2', 'heavyHit'];
const EXPLOSIONS = ['explosion1', 'explosion2', 'bomb'];
const CROWD = {
  gasp: ['ooh', 'groan'], cheer: ['crowdRoar', 'cheer', 'crowdApplause'], small: ['cheerSmall', 'crowdApplause', 'cheer'],
  groan: ['groan', 'crowdBoo'], boo: ['crowdBoo', 'groan'], chant: ['crowdChant', 'crowdRoar'],
};

// ── music (streamed <audio> elements → music bus, cross-faded) ──────────────
// Songs per family: music-<family>-<a|b|c|d>.mp3
const FAMILIES = {
  menu: 4, build: 4, credits: 2,
  colosseum: 3, lava: 3, frost: 3, neon: 3, forest: 3, desert: 3,
  swamp: 2, sky: 2, graveyard: 2, dojo: 2, ship: 2, jungle: 2, crystal: 2,
  rooftop: 2, beach: 2, castle: 2, factory: 2, candy: 2,
  celestial: 3, olympus: 2, abyss: 2,
  army: 3, business: 3, war: 3,
};
const REGULAR = ['colosseum', 'lava', 'frost', 'neon', 'forest', 'desert', 'swamp', 'sky', 'graveyard', 'dojo', 'ship', 'jungle', 'crystal', 'rooftop', 'beach', 'castle', 'factory', 'candy'];
const GODLY = ['celestial', 'olympus', 'abyss'];
const TRACKS = {};
const FAMILY_OF = {};
for (const [fam, n] of Object.entries(FAMILIES)) {
  for (let i = 0; i < n; i++) {
    const name = `${fam}-${'abcdefgh'[i]}`;
    TRACKS[name] = `/audio/music-${name}.mp3`;
    FAMILY_OF[name] = fam;
  }
}
const famTracks = (fam) => Object.keys(TRACKS).filter(t => FAMILY_OF[t] === fam);
// interleaved pools (neighbours come from different maps) for arenas we don't know
function pool(fams) {
  const lists = fams.map(famTracks), out = [];
  for (let i = 0; i < 4; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}
const ARENA_POOL = pool(REGULAR);
const GODLY_POOL = pool(GODLY);
const FAMILY_VOL = { menu: 0.26, build: 0.28, credits: 0.34, army: 0.42, business: 0.32, war: 0.38 };
const trackVol = (name) => FAMILY_VOL[FAMILY_OF[name]] || (GODLY.includes(FAMILY_OF[name]) ? 0.42 : 0.4);

// Arena ids we don't know yet: guess a family from the id / name.
const MAP_HINTS = [
  [/olymp|zeus|pantheon/, 'olympus'], [/abyss|void|cosmic|space|star/, 'abyss'], [/celest|throne|heaven|divine|god/, 'celestial'],
  [/swamp|bog|marsh|witch/, 'swamp'], [/sky|cloud|wind|air/, 'sky'], [/grave|crypt|tomb|haunt|ghost|undead|cemet/, 'graveyard'],
  [/dojo|sakura|japan|samurai|ninja|shrine|temple of/, 'dojo'], [/ship|pirate|deck|sea|ocean|harbou?r|port/, 'ship'],
  [/jungle|aztec|maya|tribal|ruins of/, 'jungle'], [/crystal|cave|cavern|gem|mine/, 'crystal'], [/rain|roof|noir|night|cyber/, 'rooftop'],
  [/beach|tropic|island|sunset|coast|surf/, 'beach'], [/castle|keep|fort|court|medieval|king/, 'castle'],
  [/factory|clock|steam|gear|industr|machine/, 'factory'], [/candy|sweet|sugar|cake|toy|sweets/, 'candy'],
  [/ice|icy|snow|frost|glacier|tundra|winter/, 'frost'], [/lava|fire|volcan|forge|magma|inferno/, 'lava'],
  [/neon|grid|synth|city|street/, 'neon'], [/forest|wood|grove|glade|tree/, 'forest'], [/desert|sand|dune|pyramid|egypt/, 'desert'],
  [/colos|arena|stone|pit/, 'colosseum'],
];
function familyForTheme(th) {
  if (th === null || th === undefined || th === '') return null;
  const id = String(th).toLowerCase();
  if (REGULAR.includes(id) || GODLY.includes(id)) return id;
  for (const [re, fam] of MAP_HINTS) if (re.test(id)) return fam;
  return null;
}

// Per-match memory: which song each round got (so a replay of round 3 plays round 3's song,
// and no two rounds of a match share one even when an arena repeats).
const plan = { match: null, rounds: new Map() };
function choose(list, start, { mn = 0, rd = 0, write = false, fallback = null } = {}) {
  if (!list.length) return null;
  let rounds = null;
  if (mn && rd) {
    if (plan.match !== mn && write) { plan.match = mn; plan.rounds = new Map(); }
    if (plan.match === mn) rounds = plan.rounds;
  }
  if (rounds) {
    const prev = rounds.get(rd);
    if (prev && list.includes(prev)) return prev;
  }
  const taken = new Set();
  if (rounds) for (const [r, t] of rounds) if (r !== rd) taken.add(t);
  let pick = null;
  const s = ((start % list.length) + list.length) % list.length;
  for (let i = 0; i < list.length && !pick; i++) { const t = list[(s + i) % list.length]; if (!taken.has(t)) pick = t; }
  if (!pick && fallback) for (let i = 0; i < fallback.length && !pick; i++) { const t = fallback[(s + rd + i) % fallback.length]; if (!taken.has(t)) pick = t; }
  if (!pick) pick = list[s];
  if (rounds && write) rounds.set(rd, pick);
  return pick;
}

function fightTrack({ lv, rd, mn, theme, mode, rotation = 0, live: isLive = false }) {
  const o = { mn, rd, write: isLive };
  if (mode === 'army' || mode === 'business' || mode === 'war') return choose(famTracks(mode), (mn - 1) + (rd - 1), o);
  const th = theme && typeof theme === 'object' ? theme : { id: theme };
  const fam = familyForTheme(th.id) || familyForTheme(th.name);
  if (fam) {
    const godly = GODLY.includes(fam);
    // how often this arena already came up in the match: godly rounds (10–12) may share one arena,
    // regular arenas only repeat once the rotation wraps around
    const occ = godly ? Math.max(0, rd - 10) : rotation > 0 ? Math.floor((rd - 1) / rotation) : 0;
    return choose(famTracks(fam), (mn - 1) + occ, { ...o, fallback: godly ? GODLY_POOL : ARENA_POOL });
  }
  // unknown / missing arena: a mixed pool (godly levels get the godly songs)
  return choose(lv >= 10 ? GODLY_POOL : ARENA_POOL, (mn - 1) * 5 + (rd - 1), o);
}

let musicCtx = { mn: 1, rd: 1, lv: 1, final: false };
let menuTurn = 0;
try { menuTurn = Math.max(0, Math.floor(Number(localStorage.getItem('aifight-menu-turn')) || 0)); } catch { /* ignore */ }

/**
 * Which song fits a moment. phase: 'menu'|'idle' · 'building' · 'countdown'|'fighting'|'replay'
 * · 'result'|'round_over' (silence: the stingers play) · 'match_over'|'credits'.
 * Other fields: level, round, matchNumber, theme ({id, name} or id), mode ('army' | 'business' | …),
 * rotation (how many regular arenas rotate; optional), finalRound, live (false for replays).
 * Returns a track name ('lava-b', 'build-c', …), the alias 'menu' (rotates each time the menu
 * music starts) or null (silence).
 */
export function musicTrackFor(o = {}) {
  const lv = clamp(Math.floor(Number(o.level) || Number(o.round) || 1), 1, 99);
  const rd = clamp(Math.floor(Number(o.round) || lv), 1, 99);
  const mn = Math.max(1, Math.floor(Number(o.matchNumber) || 1));
  const phase = o.phase;
  const isLive = o.live !== undefined ? !!o.live : phase !== 'replay';
  if (isLive && phase !== 'menu' && phase !== 'idle') musicCtx = { mn, rd, lv, final: rd >= (Number(o.finalRound) || 12) };
  switch (phase) {
    case 'menu': case 'idle': return 'menu';
    case 'building': case 'build': return choose(famTracks('build'), (mn - 1) + (rd - 1));
    case 'countdown': case 'fighting': case 'fight': case 'live': case 'replay':
      return fightTrack({ lv, rd, mn, theme: o.theme, mode: o.mode, rotation: Number(o.rotation) || 0, live: isLive });
    case 'result': case 'round_over': return null;
    case 'match_over': case 'credits': return choose(famTracks('credits'), mn - 1);
    default: return 'menu';
  }
}

// alias → concrete song ('menu' rotates each time it starts; old names still work)
function resolveTrack(name) {
  if (!name) return null;
  if (TRACKS[name]) return name;
  const { mn, rd, lv } = musicCtx;
  switch (name) {
    case 'menu': case 'idle': {
      if (wantTrack && FAMILY_OF[wantTrack] === 'menu') return wantTrack;
      const list = famTracks('menu');
      const t = list[menuTurn % list.length];
      menuTurn = (menuTurn + 1) % 1000;
      try { localStorage.setItem('aifight-menu-turn', String(menuTurn)); } catch { /* ignore */ }
      return t;
    }
    case 'build': case 'building': return musicTrackFor({ phase: 'building', round: rd, matchNumber: mn, live: false });
    case 'credits': case 'match_over': return musicTrackFor({ phase: 'match_over', matchNumber: mn, live: false });
    case 'fight': case 'intense': return fightTrack({ lv, rd, mn });
    default: {
      if (FAMILIES[name]) return choose(famTracks(name), (mn - 1) + (GODLY.includes(name) ? Math.max(0, rd - 10) : rd - 1));
      return null;
    }
  }
}

const players = {};
const trackState = {}; // name → 'ok' | 'error'
let wantTrack = null;
let fadeTimer = null;

// Once a song runs through WebAudio its fade level lives on its own gain node (element volume stays 1).
function connectEl(a) {
  if (a._node || !ctx || !musicBus) return;
  try {
    const g = ctx.createGain();
    g.gain.value = a.volume;
    a._node = ctx.createMediaElementSource(a);
    a._node.connect(g);
    g.connect(musicBus);
    a._gain = g;
    a.volume = 1;
  } catch { a._node = null; a._gain = null; }
}
const getLevel = (a) => (a._gain ? a._gain.gain.value : a.volume);
function setLevel(a, v) { if (a._gain) a._gain.gain.value = v; else a.volume = v; }
function player(name) {
  let a = players[name];
  if (!a) {
    a = new Audio(TRACKS[name]);
    a.loop = true;
    a.preload = 'auto';
    a.volume = 0;
    a.addEventListener('error', () => { trackState[name] = 'error'; });
    a.addEventListener('canplaythrough', () => { if (trackState[name] !== 'error') trackState[name] = 'ok'; });
    players[name] = a;
  }
  connectEl(a);
  return a;
}
// A song that faded out is released (the next time it starts from the top).
function dropPlayer(name) {
  const a = players[name];
  if (!a) return;
  try { a.pause(); } catch { /* ignore */ }
  try { if (a._node) a._node.disconnect(); if (a._gain) a._gain.disconnect(); } catch { /* ignore */ }
  try { a.removeAttribute('src'); a.load(); } catch { /* ignore */ }
  delete players[name];
}

function musicTarget(name) {
  if (muted || !musicOn) return 0;
  return Math.min(1, volume * trackVol(name) * 1.6);
}

function runFade() {
  if (fadeTimer) return;
  fadeTimer = setInterval(() => {
    let busy = false;
    for (const name of Object.keys(players)) {
      const a = players[name];
      const target = name === wantTrack ? musicTarget(name) : 0;
      const step = 0.03; // ≈ 1.5 s cross-fade
      const lv = getLevel(a);
      if (Math.abs(lv - target) > step) {
        setLevel(a, clamp(lv + (lv < target ? step : -step), 0, 1));
        busy = true;
      } else setLevel(a, target);
      if (getLevel(a) === 0 && name !== wantTrack) dropPlayer(name);
    }
    if (!busy) { clearInterval(fadeTimer); fadeTimer = null; }
  }, 50);
}

// Ducking on the music bus: fast attack, smooth release; overlapping ducks merge.
let duckEnd = 0;
let duckDepth = 1;
function duck(ms, level = 0.35) {
  const c = ctx;
  if (!c || !musicBus) return;
  const now = c.currentTime;
  const end = now + ms / 1000;
  const active = now < duckEnd;
  if (active && level >= duckDepth && end <= duckEnd) return;
  duckDepth = active ? Math.min(duckDepth, level) : level;
  duckEnd = Math.max(end, active ? duckEnd : 0);
  const g = musicBus.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(duckDepth, now + 0.035);
  g.setValueAtTime(duckDepth, duckEnd);
  g.linearRampToValueAtTime(1, duckEnd + 0.55);
}

function startTrack(name) {
  const a = player(name);
  if (a.paused) a.play().catch(() => { /* not allowed yet: retried on unlock */ });
}

/** Switch the background music: a track name ('lava-b'), an alias ('menu', 'build', 'credits', 'fight', 'celestial', 'army', …) or null (silence). */
export function setMusic(name) {
  const next = resolveTrack(name);
  if (next === wantTrack) return;
  wantTrack = next;
  if (next && ctx && musicTarget(next) > 0) startTrack(next);
  runFade();
}
/** Pick the song for {phase, level, round, matchNumber, theme, mode} and cross-fade to it. Returns the track name. */
export function musicFor(opts) { setMusic(musicTrackFor(opts)); return wantTrack; }
export function currentMusic() { return wantTrack; }
/** Every song: { name: url } (families: menu, build, credits, one per arena, army, business). */
export function musicTracks() { return Object.assign({}, TRACKS); }

function resumeMusic() {
  for (const a of Object.values(players)) connectEl(a);
  if (!wantTrack || musicTarget(wantTrack) <= 0) { runFade(); return; }
  if (ctx) startTrack(wantTrack);
  runFade();
}

// ── public controls ─────────────────────────────────────────────────────────
export function unlock() {
  const c = ensure();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  loadSamples();
  resumeMusic();
}
export function isMuted() { return muted; }
export function isMusicOn() { return musicOn; }
export function getVolume() { return volume; }
export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem('aifight-muted', muted ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.value = gainValue();
  resumeMusic();
}
export function setMusicOn(on) {
  musicOn = !!on;
  try { localStorage.setItem('aifight-music', musicOn ? '1' : '0'); } catch { /* ignore */ }
  resumeMusic();
}
export function setVolume(v) {
  volume = Math.max(0, Math.min(1, Number(v) || 0));
  try { localStorage.setItem('aifight-volume', String(volume)); } catch { /* ignore */ }
  if (master) master.gain.value = gainValue();
  resumeMusic();
}

function live() {
  if (muted) return null;
  const c = ensure();
  return c && c.state === 'running' ? c : null;
}

// ── synth layers + fallback ─────────────────────────────────────────────────
function tone({ type = 'square', f0, f1 = f0, dur = 0.1, vol = 0.5, at = 0, attack = 0.004 }) {
  const c = live();
  if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol * 0.6, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(sfxBus);
  o.start(t);
  o.stop(t + dur + 0.03);
}

let noiseBuf = null;
function noiseBuffer(c) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.6), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let v = 0, seed = 1;
    for (let i = 0; i < d.length; i++) {
      if (i % 4 === 0) { seed = (seed * 16807) % 2147483647; v = (seed / 2147483647) * 2 - 1; }
      d[i] = v;
    }
  }
  return noiseBuf;
}
function noise({ dur = 0.15, vol = 0.4, at = 0, hp = 800, lp = 6000 }) {
  const c = live();
  if (!c) return;
  const t = c.currentTime + at;
  const s = c.createBufferSource();
  s.buffer = noiseBuffer(c);
  const high = c.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = hp;
  const low = c.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = lp;
  const g = c.createGain();
  g.gain.setValueAtTime(vol * 0.6, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(high); high.connect(low); low.connect(g); g.connect(sfxBus);
  s.start(t);
  s.stop(t + dur + 0.03);
}

/** Sub-bass thump (a falling sine): the weight under heavy hits, felt more than heard. */
function subBoom({ at = 0, vol = 0.5, len = 0.45, f0 = 110, f1 = 34 } = {}) {
  const c = live();
  if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + len);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g);
  g.connect(sfxBus);
  o.start(t);
  o.stop(t + len + 0.05);
}

/** A rising charge-up of exactly T seconds (detuned saws through an opening filter + an air swell). */
function swell(T, { vol = 0.1, f0 = 70, f1 = 240 } = {}) {
  const c = live();
  if (!c) return null;
  const t = c.currentTime;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + T * 0.92);
  g.gain.linearRampToValueAtTime(0.0001, t + T + 0.05);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 5;
  lp.frequency.setValueAtTime(180, t);
  lp.frequency.exponentialRampToValueAtTime(3600, t + T);
  const oscs = [-9, 9].map(det => {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.detune.value = det;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + T);
    o.connect(lp);
    o.start(t);
    o.stop(t + T + 0.1);
    return o;
  });
  lp.connect(g);
  g.connect(sfxBus);
  const n = c.createBufferSource();
  n.buffer = noiseBuffer(c);
  n.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.3;
  bp.frequency.setValueAtTime(350, t);
  bp.frequency.exponentialRampToValueAtTime(6500, t + T);
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(vol * 1.5, t + T * 0.95);
  ng.gain.linearRampToValueAtTime(0.0001, t + T + 0.05);
  n.connect(bp); bp.connect(ng); ng.connect(sfxBus);
  n.start(t);
  n.stop(t + T + 0.1);
  return {
    stop(f = 0.1) {
      const now = c.currentTime;
      for (const gg of [g, ng]) {
        gg.gain.cancelScheduledValues(now);
        gg.gain.setValueAtTime(Math.max(0.0001, gg.gain.value), now);
        gg.gain.exponentialRampToValueAtTime(0.0001, now + f);
      }
      try { oscs.forEach(o => o.stop(now + f + 0.02)); n.stop(now + f + 0.02); } catch { /* ended */ }
    },
  };
}

// Don't let a flurry of events turn into noise.
const last = {};
function gate(name, ms) {
  const now = performance.now();
  if (last[name] && now - last[name] < ms) return false;
  last[name] = now;
  return true;
}

let lastSting = -1e9; // victory / match-over stingers never double up
let lastCountAt = -1e9;
let lastStack = { at: -1e9, tier: -1 };

const arp = (notes, { type = 'square', step = 0.07, dur = 0.09, vol = 0.2, at = 0 } = {}) =>
  notes.forEach((f, i) => tone({ type, f0: f, dur, vol, at: at + i * step }));

/**
 * Layered impact: transient (punch / blade) + body (heavy thud) + sub boom + tail (boom / cinematic).
 * tier 0 light · 1 solid · 2 heavy · 3 huge (K.O., ultimates, godly powers). Big tiers duck the music.
 */
function stack(tier, { blade = false, at = 0, pan = 0, vol = 1 } = {}) {
  const r = vary('stack', 0.06);
  const lead = blade ? rot('slash', SLASHES) : rot('hit', HITS);
  const ok = S(lead, { vol: Math.min(1, (0.62 + 0.1 * tier) * vol), rate: (tier >= 2 ? 0.93 : 1) * r, at, pan, duration: 0.9, fade: 0.3, prio: tier >= 2 ? 2 : 1 });
  if (!ok) {
    tone({ type: 'square', f0: 260 - tier * 30, f1: 50, dur: 0.12 + tier * 0.06, vol: 0.3 + tier * 0.08, at });
    noise({ dur: 0.08 + tier * 0.05, vol: 0.3, hp: 300, at });
  }
  if (blade && tier >= 1) S(rot('hit', HITS), { vol: 0.35 * vol, rate: 1.06 * r, at, pan, duration: 0.6, fade: 0.2 });
  if (tier >= 1) S(rot('heavy', HEAVIES), { vol: (0.28 + 0.14 * tier) * vol, rate: (tier >= 2 ? 0.86 : 0.97) * r, at: at + 0.004, pan: pan * 0.6, duration: 1.3, fade: 0.45, prio: tier >= 2 ? 2 : 1 });
  if (tier >= 1) subBoom({ at, vol: (0.2 + 0.13 * tier) * vol, len: 0.22 + 0.16 * tier, f0: 120 - tier * 8 });
  if (tier >= 2) S(tier >= 3 ? 'impactCine' : 'boom', { vol: (0.26 + 0.1 * tier) * vol, at: at + 0.01, duration: tier >= 3 ? 3.4 : 1.8, fade: 0.9, prio: 2 });
  if (tier >= 3) S('subDrop', { vol: 0.5 * vol, at, duration: 2.6, fade: 1, prio: 2 });
  if (tier >= 1) duck(tier >= 3 ? 1100 : tier === 2 ? 480 : 220, tier >= 3 ? 0.28 : tier === 2 ? 0.45 : 0.7);
  lastStack = { at: performance.now(), tier };
}

// Crowd reactions to big moments (one at a time, rotating recordings).
function crowd(kind, strong = false) {
  if (!gate('crowd', strong ? 1700 : 2500)) return;
  const set = kind === 'cheer' && !strong ? 'small' : kind;
  const list = CROWD[set] || CROWD.gasp;
  const long = kind === 'cheer' || kind === 'chant';
  S(rot(`crowd-${set}`, list), { vol: strong ? 0.5 : 0.36, rate: vary(`crowd-${set}`, 0.03), duration: long ? (strong ? 4.5 : 2.8) : 2.4, fade: 1.1, prio: 2 });
}

// Announcer lines (only when the recording exists; never twice within 2.5 s).
function announce(name, at = 0, vol = 0.95) {
  if (!buffers[name]) return false;
  if (!gate(`ann-${name}`, 2500)) return true;
  duck(1600 + at * 1000, 0.4);
  return S(name, { vol, at, prio: 3, duration: 2.6, fade: 0.4 });
}

// Charge-ups: a riser whose peak lands exactly on the release (ultimate `charge`, godly `cast`).
const pend = {}; // side → { kind, ab, id, t, T, voices }
function startCharge(side, kind, T, extra = {}) {
  cancelCharge(side, 0.05);
  const vs = [];
  const want = T <= 1.9 ? 'riserShort' : 'riserLong';
  const nm = buffers[want] ? want : buffers.riserShort ? 'riserShort' : buffers.riserLong ? 'riserLong' : null;
  if (nm) {
    const P = Math.min(buffers[nm].duration, RISER_PEAK[nm] || buffers[nm].duration);
    const v = P >= T ? S(nm, { vol: 0.75, offset: P - T, prio: 2 }) : S(nm, { vol: 0.75, at: T - P, prio: 2 });
    if (v && v.stop) vs.push(v);
  }
  const sw = swell(T, kind === 'god' ? { vol: 0.12, f0: 55, f1: 300 } : { vol: 0.085, f0: 70, f1: 230 });
  if (sw) vs.push(sw);
  pend[side] = { kind, ab: extra.ab, id: extra.id, t: performance.now(), T, voices: vs };
}
function cancelCharge(side, f = 0.12) {
  const p = pend[side];
  if (!p) return false;
  p.voices.forEach(v => v.stop(f));
  delete pend[side];
  return true;
}
function release(tier, pan = 0) {
  if (!S('release', { vol: tier >= 3 ? 0.9 : 0.8, prio: 2, pan: pan * 0.4, duration: 3, fade: 1 })) S('epicHit', { vol: 0.6, prio: 2, duration: 3, fade: 1.2 });
  subBoom({ vol: 0.6, len: 0.9, f0: 95, f1: 30 });
  S('braam', { vol: tier >= 3 ? 0.4 : 0.28, at: 0.02, duration: 2.4, fade: 1, prio: 2 });
  duck(tier >= 3 ? 2600 : 1800, 0.28);
}

export const sfx = {
  hit(dmg = 30) {
    if (!gate('hit', 45)) return;
    stack(dmg >= 150 ? 3 : dmg >= 90 ? 2 : dmg >= 40 ? 1 : 0);
  },
  swing() { if (gate('swing', 70) && !S(rot('whoosh', WHOOSHES), { vol: 0.4, rate: vary('swing', 0.08) })) noise({ dur: 0.08, vol: 0.14, hp: 2400, lp: 9000 }); },
  shoot() { if (gate('shoot', 60) && !S(rot('shot', ['magicCast', 'cast']), { vol: 0.32, rate: vary('shoot', 0.08), duration: 0.7, fade: 0.3 })) tone({ type: 'square', f0: 900, f1: 420, dur: 0.07, vol: 0.14 }); },
  burst(big = false) {
    if (!gate('burst', 90)) return;
    if (S(big ? 'explosion2' : rot('expl', EXPLOSIONS), { vol: big ? 0.8 : 0.6, rate: vary('burst', 0.05), duration: 2.4, fade: 0.9 })) subBoom({ vol: big ? 0.5 : 0.32, len: big ? 0.8 : 0.5 });
    else {
      tone({ type: 'sawtooth', f0: 170, f1: 40, dur: 0.32, vol: 0.28 });
      noise({ dur: 0.3, vol: 0.3, hp: 90, lp: 2200 });
    }
  },
  dash() {
    if (!gate('dash', 90)) return;
    if (!S(rot('whoosh', WHOOSHES), { vol: 0.45, rate: 0.7 * vary('dash', 0.06) })) noise({ dur: 0.15, vol: 0.18, hp: 1500, lp: 6000 });
    tone({ type: 'triangle', f0: 280, f1: 900, dur: 0.12, vol: 0.08 });
  },
  zone() { if (gate('zone', 120)) { tone({ type: 'triangle', f0: 220, f1: 110, dur: 0.4, vol: 0.24 }); tone({ type: 'sine', f0: 110, f1: 90, dur: 0.7, vol: 0.14, at: 0.05 }); } },
  stun() {
    if (!gate('stun', 120)) return;
    tone({ type: 'square', f0: 1300, f1: 650, dur: 0.07, vol: 0.18 });
    tone({ type: 'square', f0: 1300, f1: 650, dur: 0.07, vol: 0.18, at: 0.09 });
    tone({ type: 'triangle', f0: 1568, dur: 0.06, vol: 0.1, at: 0.2 });
  },
  heal() { if (gate('heal', 180) && !S(buffers.healMagic ? 'healMagic' : 'heal', { vol: 0.42, rate: vary('heal', 0.04), duration: 2, fade: 0.8 })) arp([523, 659, 784], { type: 'triangle', step: 0.06, dur: 0.12, vol: 0.2 }); },
  shield() { if (gate('shield', 180) && !S('shield', { vol: 0.42, duration: 1.4, fade: 0.5 })) tone({ type: 'sine', f0: 380, f1: 820, dur: 0.26, vol: 0.26 }); },
  buff() { if (gate('buff', 180) && !S('powerup', { vol: 0.45, rate: vary('buff', 0.05) })) arp([392, 523, 784], { step: 0.05, dur: 0.08, vol: 0.14 }); },
  evade() { if (gate('evade', 150)) { S('whip', { vol: 0.3, rate: 1.3 }); tone({ type: 'triangle', f0: 1400, f1: 2200, dur: 0.06, vol: 0.1 }); } },
  ooh() { crowd('gasp'); },
  ko(pan = 0) {
    duck(3400, 0.22);
    if (!S('koHit', { vol: 0.95, prio: 2, pan, duration: 2.5, fade: 0.8 })) {
      if (!S('heavyHit', { vol: 0.9, rate: 0.8, prio: 2 })) {
        tone({ type: 'square', f0: 440, f1: 50, dur: 0.95, vol: 0.45 });
        noise({ dur: 0.7, vol: 0.42, hp: 70, lp: 1600 });
      }
    }
    subBoom({ vol: 0.75, len: 1.1, f0: 90, f1: 28 });
    S('impactCine', { vol: 0.55, at: 0.02, duration: 3.5, fade: 1.2, prio: 2 }) || S('boom', { vol: 0.6, duration: 2.2, fade: 0.8, prio: 2 });
    S('bodyfall', { vol: 0.7, at: 0.5, pan, prio: 2 });
    announce('annKo', 0.3);
    S(buffers.crowdRoar ? 'crowdRoar' : 'cheer', { vol: 0.55, at: 0.35, duration: 5, fade: 1.6, prio: 2 });
  },
  count() {
    const first = performance.now() - lastCountAt > 2500;
    lastCountAt = performance.now();
    tone({ type: 'square', f0: 440, dur: 0.13, vol: 0.28 });
    // the only announcer line Epidemic has is "Round 1": it opens a match; annFinal if it's ever added
    if (first) { if (musicCtx.final) announce('annFinal', 0.05); else if (musicCtx.rd === 1) announce('annRound', 0.05, 0.85); }
  },
  fight() {
    // the start bell right after the 3-2-1 gets the announcer; the end-of-time bell doesn't
    const start = performance.now() - lastCountAt < 3500;
    if (!S('bell', { vol: 0.75, duration: 2.6, fade: 1.2, prio: 2 })) {
      tone({ type: 'square', f0: 880, dur: 0.38, vol: 0.26 });
      tone({ type: 'square', f0: 1320, dur: 0.38, vol: 0.16 });
    }
    if (start) { announce('annFight', 0.08); crowd('cheer'); }
  },
  whoosh() { if (!S(rot('whoosh', WHOOSHES), { vol: 0.5, rate: 0.55 })) noise({ dur: 0.35, vol: 0.2, hp: 600, lp: 4000 }); },
  callout() { if (gate('callout', 450)) arp([659, 880, 1175], { step: 0.05, dur: 0.07, vol: 0.16 }); },
  victory() {
    lastSting = performance.now();
    duck(5500, 0.25);
    const ok = S('victorySting', { vol: 0.7, prio: 2 }) || S('fanfare', { vol: 0.7, prio: 2 });
    if (ok) {
      announce('annVictory', 0.25, 0.85);
      S(buffers.crowdRoar ? 'crowdRoar' : 'cheer', { vol: 0.42, at: 0.3, duration: 5, fade: 2, prio: 2 });
      return;
    }
    const n = [523, 659, 784, 1047, 784, 1047];
    const at = [0, 0.12, 0.24, 0.36, 0.52, 0.64];
    n.forEach((f, i) => tone({ type: 'square', f0: f, dur: i === 5 ? 0.5 : 0.12, vol: 0.22, at: at[i] }));
  },
  draw() {
    duck(4000, 0.3);
    if (!S('defeatSting', { vol: 0.55, prio: 2 }) && !S('fall', { vol: 0.6 })) arp([392, 370, 349, 330], { type: 'triangle', step: 0.18, dur: 0.2, vol: 0.24 });
    crowd('groan');
  },
  tick() { tone({ type: 'square', f0: 1000, dur: 0.04, vol: 0.12 }); },
  alarm() { if (!S('alarm', { vol: 0.55 })) arp([880, 660, 880, 660], { step: 0.12, dur: 0.1, vol: 0.22 }); },
  ready() { if (!S('coin', { vol: 0.55 })) arp([660, 990], { step: 0.09, dur: 0.1, vol: 0.2 }); },
  levelUp(level) { ui('levelup', level); },
  click() { if (!S('uiClick', { vol: 0.3, rate: vary('click', 0.05) })) tone({ type: 'square', f0: 700, dur: 0.03, vol: 0.08 }); },
  save() { if (gate('save', 300)) tone({ type: 'triangle', f0: 1500, dur: 0.035, vol: 0.05 }); },
  crit() {
    if (!gate('crit', 160)) return;
    if (!S('crit', { vol: 0.5, rate: vary('crit', 0.05), duration: 1.1, fade: 0.4 })) {
      tone({ type: 'square', f0: 1760, f1: 2640, dur: 0.06, vol: 0.14 });
      tone({ type: 'square', f0: 2640, dur: 0.05, vol: 0.1, at: 0.05 });
    }
  },
  counter() {
    if (!gate('counter', 200)) return;
    if (!S('clang', { vol: 0.62, rate: vary('clang', 0.05), prio: 2 })) {
      tone({ type: 'square', f0: 1900, f1: 950, dur: 0.07, vol: 0.2 });
      noise({ dur: 0.08, vol: 0.2, hp: 3000, lp: 9000, at: 0.02 });
    }
    S('block', { vol: 0.5, rate: 1.05 });
  },
  trap() { if (gate('trap', 200)) { tone({ type: 'square', f0: 320, dur: 0.04, vol: 0.14 }); tone({ type: 'square', f0: 240, dur: 0.05, vol: 0.12, at: 0.05 }); } },
  beam() { if (gate('beam', 250) && !S('beam', { vol: 0.38, duration: 1.5, fade: 0.5 })) tone({ type: 'sawtooth', f0: 520, f1: 780, dur: 0.35, vol: 0.14 }); },
  cleanse() { if (gate('cleanse', 250) && !S('chime', { vol: 0.4, rate: 1.1, duration: 1.4, fade: 0.6 })) arp([784, 988, 1319], { type: 'triangle', step: 0.05, dur: 0.1, vol: 0.18 }); },
  slam(pan = 0) {
    if (!gate('slam', 200)) return;
    stack(2, { pan, vol: 0.9 });
    noise({ dur: 0.2, vol: 0.3, hp: 80, lp: 1200 });
  },
};
sfx.levelUpSmall = () => { if (!S('levelup', { vol: 0.55 })) arp([523, 659, 784, 1047, 1319], { step: 0.07, dur: 0.1, vol: 0.2 }); };

// ── replay events → sounds ──────────────────────────────────────────────────
// Local copy of the engine's hit flags (util.js HIT) so this module has no deps.
const HF = { STUN: 1, RESISTED: 2, SLOW: 4, BURN: 8, KNOCK: 16, LIFESTEAL: 32, CRIT: 64, ROOT: 128, SILENCE: 256, POISON: 2048, DRAIN: 4096, BLOCK: 8192 };
const WEAPON_KIND = {
  fists: 'claw', claws: 'claw', shortsword: 'slash', greatsword: 'slash', axe: 'slash', scythe: 'slash', whip: 'slash',
  katana: 'slash', shield: 'slash', dagger: 'thrust', spear: 'thrust', hammer: 'smash',
  bow: 'shoot', crossbow: 'shoot', staff: 'cast', wand: 'cast', pistol: 'gun',
};
const STYLE_KIND = { slash: 'slash', thrust: 'thrust', smash: 'smash', claw: 'claw', arrow: 'shoot', bolt: 'shoot', orb: 'cast' };

function fighterOf(rep, side) { return rep && Array.isArray(rep.fighters) ? rep.fighters[side] || null : null; }
function abilityOf(f, idx) { return f && Array.isArray(f.abilities) && idx !== undefined && idx !== null ? f.abilities[idx] || null : null; }
function weaponKindOf(ab, f) {
  if (!ab) return null;
  const wid = ab.weapon || (ab.basic && f ? (typeof f.weapon === 'string' ? f.weapon : f.weapon && f.weapon.id) : null);
  if (ab.basic && wid && WEAPON_KIND[wid]) return WEAPON_KIND[wid];
  if (ab.basic && f && f.weapon && typeof f.weapon === 'object' && f.weapon.kind) return f.weapon.kind;
  return STYLE_KIND[ab.style] || null;
}
// stereo position from the arena x coordinate (gentle: at most half-way to a speaker)
function panOf(e, rep) {
  const x = Number(e && e.x);
  if (!Number.isFinite(x)) return 0;
  const R = (rep && rep.arena && rep.arena.radius) || 600;
  return clamp(x / R, -1, 1) * 0.5;
}

let trace = null;
/** Testing aid: traceSounds(true) starts recording the cue chosen for each event (returns the array). */
export function traceSounds(on) { trace = on ? [] : null; return trace; }
function cue(name) { if (trace) trace.push(name); return name; }

function weaponSwing(kind, ab, big, pan) {
  const k = `sw-${kind}`;
  if (!gate(k, 65)) return cue(`swing:${kind}:gated`);
  const r = vary(k, 0.08);
  let ok;
  if (kind === 'thrust') ok = S('whip', { vol: big ? 0.6 : 0.42, rate: 0.75 * r, pan });
  else if (kind === 'claw') ok = S('swipe', { vol: big ? 0.6 : 0.44, rate: r, pan });
  else if (kind === 'smash') ok = S(rot('whoosh-heavy', WHOOSHES), { vol: big ? 0.65 : 0.5, rate: 0.72 * r, pan });
  else ok = S(rot('whoosh', WHOOSHES), { vol: big ? 0.62 : 0.4, rate: (ab && ab.basic ? 1 : 1.08) * r, pan });
  if (!ok) sfx.swing();
  if (big) S('swipe', { vol: 0.45, rate: 0.55, pan, prio: 2 });
  return cue(`swing:${kind || 'slash'}${big ? ':big' : ''}`);
}

function weaponShot(kind, ab, f, big, pan) {
  const k = `fi-${kind || 'ability'}`;
  if (!gate(k, 60)) return cue(`fire:${kind || 'ability'}:gated`);
  const r = vary(k, 0.07);
  if (kind === 'shoot') { if (!S('bow', { vol: 0.48, rate: (ab && ab.weapon === 'crossbow' ? 0.85 : 1) * r, duration: 0.9, fade: 0.4, pan })) sfx.shoot(); }
  else if (kind === 'gun') { if (!S('gun', { vol: 0.45, rate: r, duration: 0.9, fade: 0.5, pan })) sfx.shoot(); subBoom({ vol: 0.18, len: 0.18, f0: 140 }); }
  else if (kind === 'cast') { if (!S(rot('cast', ['magicCast', 'cast']), { vol: 0.34, rate: 1.1 * r, duration: 0.8, fade: 0.3, pan })) sfx.shoot(); }
  else if (ab && !ab.basic) { if (!S('fireball', { vol: big ? 0.55 : 0.38, rate: r, duration: 0.9, fade: 0.4, pan })) sfx.shoot(); }
  else sfx.shoot();
  return cue(`fire:${kind || 'ability'}${big ? ':big' : ''}`);
}

function hitSound(e, f, ab, rep, big, pan) {
  const dmg = Math.max(0, e.dmg || 0), fl = e.fl || 0;
  const victim = fighterOf(rep, 1 - e.a);
  const maxHp = (victim && victim.maxHp) || 1000;
  const pct = dmg / maxHp;
  const kind = weaponKindOf(ab, f);
  const blade = kind === 'slash' || kind === 'thrust' || kind === 'claw';
  let tier = pct >= 0.08 || dmg >= 90 ? 2 : pct >= 0.035 ? 1 : 0;
  if (fl & HF.CRIT) tier = Math.min(2, tier + 1);
  if (big || pct >= 0.18) tier = 3;
  const parts = [];
  if (fl & HF.BLOCK) {
    if (gate('block', 90) && !S(rot('block', ['block', 'parry']), { vol: 0.55, rate: vary('block', 0.06), pan })) sfx.counter();
    tier = Math.max(0, tier - 1);
    parts.push('block');
  }
  if (gate('hit', 45)) {
    // a flurry of big hits stays readable: the full stack at most every 110 ms
    if (tier >= 2 && performance.now() - lastStack.at < 110) tier = 1;
    stack(tier, { blade, pan, vol: fl & HF.BLOCK ? 0.6 : 1 });
    parts.push(kind || 'ability', `t${tier}`);
  } else parts.push('gated');
  if (fl & HF.CRIT) { sfx.crit(); parts.push('crit'); }
  if (fl & HF.STUN) { sfx.stun(); parts.push('stun'); }
  if (fl & HF.ROOT) { if (gate('root', 150)) { tone({ type: 'square', f0: 180, f1: 90, dur: 0.14, vol: 0.2 }); noise({ dur: 0.12, vol: 0.18, hp: 100, lp: 900 }); } parts.push('root'); }
  if (fl & HF.SILENCE) { if (gate('silence', 150)) { noise({ dur: 0.25, vol: 0.14, hp: 2500, lp: 7000 }); tone({ type: 'sine', f0: 900, f1: 300, dur: 0.25, vol: 0.12 }); } parts.push('silence'); }
  if (fl & HF.KNOCK) { if (gate('knock', 150)) S(rot('whoosh', WHOOSHES), { vol: 0.38, rate: 0.6, pan }); parts.push('knock'); }
  if (fl & (HF.LIFESTEAL | HF.DRAIN)) { if (gate('drain', 180)) tone({ type: 'sine', f0: 300, f1: 900, dur: 0.25, vol: 0.14 }); parts.push('drain'); }
  if (fl & HF.SLOW) { if (gate('slow', 200)) tone({ type: 'triangle', f0: 500, f1: 200, dur: 0.18, vol: 0.1 }); parts.push('slow'); }
  if (fl & (HF.BURN | HF.POISON)) { if (gate('sizzle', 200)) noise({ dur: 0.12, vol: 0.1, hp: 3500, lp: 9000 }); parts.push('dot'); }
  if (tier >= 3 || pct >= 0.14) crowd('gasp', tier >= 3);
  return cue(`hit:${parts.join('+')}`);
}

// Godly powers: the signature sound when the power fires (g:fire), by power id.
const GOD_SIG = {
  timestop() {
    S('godTimestop', { vol: 0.9, prio: 2, duration: 4, fade: 1.2 }) || S('chime', { vol: 0.5, rate: 0.6, duration: 2.2, fade: 1, prio: 2 });
    [0.12, 0.42, 0.72].forEach((at, i) => tone({ type: 'square', f0: i % 2 ? 900 : 1200, dur: 0.03, vol: 0.12, at }));
    S('braam', { vol: 0.32, rate: 0.7, duration: 2.5, fade: 1 });
    subBoom({ vol: 0.5, len: 1.2, f0: 80, f1: 26 });
  },
  judgment() {
    // the recording's choir rises for 2 s into its impact; the beam lands 1 s after g:fire (g:beam)
    S('godJudgment', { vol: 0.9, prio: 2, offset: 1.0, duration: 3, fade: 1.1 }) || S('holy', { vol: 0.55, duration: 2.5, fade: 1, prio: 2 });
    S('choir', { vol: 0.42, at: 0.05, duration: 3.5, fade: 1.2, prio: 2 });
  },
  blackhole() {
    S('godBlackhole', { vol: 0.9, prio: 2, duration: 4.5, fade: 1.5 }) || S('braam', { vol: 0.5, rate: 0.75, duration: 3, fade: 1.2, prio: 2 });
    subBoom({ vol: 0.6, len: 1.6, f0: 70, f1: 24 });
  },
  meteor() {
    S('godMeteor', { vol: 0.85, prio: 2, duration: 4.5, fade: 1.2 }) || S('fireball', { vol: 0.55, rate: 0.6, duration: 1.6, fade: 0.6, prio: 2 });
  },
  thunder() {
    S('godThunder', { vol: 0.95, prio: 2, duration: 4, fade: 1.2 }) || S('thunder', { vol: 0.7, duration: 3, fade: 1, prio: 2 });
    subBoom({ vol: 0.55, len: 0.8, f0: 100, f1: 30 });
  },
  avatar() {
    S('godAvatar', { vol: 0.95, prio: 2, duration: 4, fade: 1.2 }) || S('awaken', { vol: 0.65, prio: 2 });
    S('braam', { vol: 0.42, at: 0.05, duration: 3, fade: 1.2, prio: 2 });
  },
  phoenix() {
    S('godPhoenix', { vol: 0.85, prio: 2, duration: 3.4, fade: 1.1 });
    S('fireball', { vol: 0.6, rate: 0.7, duration: 2, fade: 0.8, prio: 2 }); // the flames under the screech
    S('holy', { vol: 0.3, at: 0.25, duration: 2.5, fade: 1 });
  },
  worldtree() {
    S('godWorldtree', { vol: 0.9, prio: 2, duration: 4.5, fade: 1.4 }) || S('chime', { vol: 0.5, rate: 0.7, duration: 2, fade: 1, prio: 2 });
    S('holy', { vol: 0.3, at: 0.35, duration: 2.5, fade: 1 });
    subBoom({ vol: 0.4, len: 0.9, f0: 70, f1: 30 });
  },
};

// Godly power events (`g:*`).
function godlySound(e, rep, pan) {
  const id = String(e.id || '').toLowerCase();
  switch (e.k) {
    case 'g:fire': {
      if (pend[e.a] && pend[e.a].kind === 'god') delete pend[e.a]; // the riser ends right here
      release(3, pan);
      const sig = GOD_SIG[id];
      if (sig) sig(); else S('choir', { vol: 0.4, duration: 3, fade: 1.2, prio: 2 });
      crowd('gasp', true);
      return cue(`g:fire:${sig ? id : 'generic'}`);
    }
    case 'g:resume': { // time starts again
      if (gate('g:resume', 400)) {
        if (!S('godTimestop', { vol: 0.45, rate: 1.4, duration: 1.2, fade: 0.5 })) S('chime', { vol: 0.4, rate: 1.3, duration: 1, fade: 0.5 });
        S(rot('whoosh', WHOOSHES), { vol: 0.5, rate: 0.6 });
        tone({ type: 'sine', f0: 200, f1: 900, dur: 0.35, vol: 0.14 });
      }
      return cue('g:resume');
    }
    case 'g:beam': { // judgment lands
      if (!gate('g:beam', 150)) return cue('g:beam:gated');
      stack(3, { pan, vol: 0.85 });
      S(rot('thunder', ['godThunder', 'thunder']), { vol: 0.55, rate: vary('g-beam', 0.05), duration: 3, fade: 1, prio: 2 });
      S('holy', { vol: 0.4, at: 0.05, duration: 2.5, fade: 1 });
      crowd('gasp', true);
      return cue('g:beam');
    }
    case 'g:nova': { // the black hole collapses
      if (!gate('g:nova', 200)) return cue('g:nova:gated');
      if (!S('explosion2', { vol: 0.9, prio: 2, pan, duration: 3, fade: 1 })) S('bomb', { vol: 0.8, prio: 2, pan });
      stack(3, { pan, vol: 0.7 });
      S('braam', { vol: 0.4, rate: 0.8, duration: 2.5, fade: 1, prio: 2 });
      return cue('g:nova');
    }
    case 'g:meteor': {
      if (!gate('g:meteor', 90)) return cue('g:meteor:gated');
      S(rot('g-met', EXPLOSIONS), { vol: 0.75, rate: vary('g-met', 0.08), pan, duration: 2.6, fade: 1, prio: 2 });
      subBoom({ vol: 0.5, len: 0.7, f0: 100, f1: 30 });
      duck(600, 0.4);
      return cue('g:meteor');
    }
    case 'g:bolt': {
      if (!gate('g:bolt', 100)) return cue('g:bolt:gated');
      S(rot('g-bolt', ['godThunder', 'thunder']), { vol: 0.7, rate: vary('g-bolt', 0.09), pan, duration: 2.6, fade: 1, prio: 2 });
      stack(1, { pan, vol: 0.8 });
      return cue('g:bolt');
    }
    case 'g:slam': {
      stack(3, { pan });
      S('explosion1', { vol: 0.6, pan, duration: 2, fade: 0.8, prio: 2 });
      return cue('g:slam');
    }
    case 'g:fade': { // phoenix flames mending
      if (gate('g:fade', 900)) S('fireball', { vol: 0.16, rate: 1.3, duration: 0.6, fade: 0.3, pan });
      return cue('g:fade');
    }
    case 'g:roots': {
      if (!gate('g:roots', 260)) return cue('g:roots:gated');
      if (!S('godWorldtree', { vol: 0.35, rate: 1.15 * vary('g-roots', 0.06), duration: 1.2, fade: 0.5, pan })) tone({ type: 'triangle', f0: 140, f1: 70, dur: 0.25, vol: 0.2 });
      stack(0, { pan, vol: 0.7 });
      return cue('g:roots');
    }
    case 'g:rebirth': {
      duck(5000, 0.2);
      S('godPhoenix', { vol: 0.95, prio: 2, duration: 4, fade: 1.2 }) || S('fireball', { vol: 0.6, rate: 0.6, prio: 2 });
      S('holy', { vol: 0.5, at: 0.2, duration: 3, fade: 1.2, prio: 2 });
      S('choir', { vol: 0.4, at: 0.3, duration: 3, fade: 1.2, prio: 2 });
      subBoom({ vol: 0.6, len: 1, f0: 90, f1: 30 });
      crowd('cheer', true);
      return cue('g:rebirth');
    }
    case 'g:error': return cue('g:error:quiet');
    default: break;
  }
  // unknown g:* kinds: pick a family by keywords in the kind / id
  const key = `${e.k} ${e.id || ''} ${e.v || ''}`.toLowerCase();
  if (!gate(`g-${e.k}`, 140)) return cue(`${e.k}:gated`);
  if (/thunder|bolt|storm|smite|zeus|lightning|judg/.test(key)) { S(rot('g-bolt', ['godThunder', 'thunder']), { vol: 0.55, rate: vary('g-th', 0.05), duration: 3, fade: 1, prio: 2 }); return cue(`${e.k}:thunder`); }
  if (/heal|bless|rebirth|revive|grace|halo|holy|sanct|mercy/.test(key)) { S('holy', { vol: 0.45, duration: 2.5, fade: 1, prio: 2 }); return cue(`${e.k}:holy`); }
  if (/time|freeze|stop|chrono|still/.test(key)) { S('chime', { vol: 0.5, rate: 0.6, duration: 2.2, fade: 1, prio: 2 }); S('braam', { vol: 0.3, duration: 2, fade: 0.8 }); return cue(`${e.k}:time`); }
  if (/meteor|star|nova|comet|sun|flare|explo|cataclysm|fall|rain/.test(key)) { S(rot('g-met', EXPLOSIONS), { vol: 0.6, rate: vary('g-bo', 0.05), duration: 2.5, fade: 1, prio: 2 }); subBoom({ vol: 0.4 }); return cue(`${e.k}:boom`); }
  if (/blade|sword|spear|lance|edge/.test(key)) { S('clang', { vol: 0.5, rate: 0.8 }); stack(2, { blade: true, pan }); return cue(`${e.k}:blade`); }
  if (/void|black|hole|gravity|pull|abyss|dark/.test(key)) { S('braam', { vol: 0.45, rate: 0.8, duration: 2.5, fade: 1, prio: 2 }); return cue(`${e.k}:void`); }
  if (/end|expire|fade/.test(key)) { tone({ type: 'sine', f0: 700, f1: 250, dur: 0.4, vol: 0.12 }); return cue(`${e.k}:fade`); }
  if (/hit|dmg|strike|tick/.test(key)) { stack(1, { pan }); return cue(`${e.k}:hit`); }
  S('boom', { vol: 0.4, duration: 1.8, fade: 0.8 });
  S('choir', { vol: 0.25, duration: 2, fade: 0.9 });
  return cue(`${e.k}:generic`);
}

const EMOTE = {
  taunt() { S('whip', { vol: 0.35, rate: 0.9 }); arp([660, 550, 660, 550], { type: 'square', step: 0.09, dur: 0.08, vol: 0.12, at: 0.05 }); },
  laugh() { if (!S('laugh', { vol: 0.45, rate: vary('laugh', 0.06) })) arp([700, 620, 700, 620, 560], { step: 0.08, dur: 0.07, vol: 0.12 }); },
  salute() { arp([392, 523, 659, 784], { type: 'square', step: 0.11, dur: 0.14, vol: 0.14 }); },
  cheer() { crowd('cheer'); },
  bow() { if (!S('gong', { vol: 0.25, rate: 1.3, duration: 1.6, fade: 0.8 })) tone({ type: 'sine', f0: 523, f1: 392, dur: 0.5, vol: 0.16 }); },
  rage() { S('shout', { vol: 0.45, rate: 0.85 }); tone({ type: 'sawtooth', f0: 110, f1: 70, dur: 0.5, vol: 0.2 }); subBoom({ vol: 0.3, len: 0.5 }); },
};

/**
 * Play the sound for one replay event (SPEC4 §3; v2/v3 kinds and g:* too). Returns the cue name.
 * ctx = { replay, big }  — `replay` gives weapons / abilities / max HP / arena, `big` forces the big variant.
 */
export function playEvent(e, c = {}) {
  if (!e || typeof e.k !== 'string') return cue('none');
  const rep = c.replay || null;
  const f = fighterOf(rep, e.a);
  const ab = abilityOf(f, e.ab);
  const isUlt = !!(f && ab && f.ultIdx !== undefined && f.ultIdx !== null && f.ultIdx === e.ab);
  const big = !!c.big || isUlt;
  const pan = panOf(e, rep);
  // an ultimate's first action after its charge-up: the release
  const p = pend[e.a];
  if (p) {
    if (performance.now() - p.t > (p.T + 3) * 1000) delete pend[e.a];
    else if (p.kind === 'ult' && e.ab === p.ab && e.k !== 'ult' && e.k !== 'cast' && e.k !== 'interrupt' && e.k !== 'cancel') {
      delete pend[e.a];
      release(2, pan);
      if (trace) trace.push('ult:release');
    }
  }
  if (e.k.startsWith('g:')) return godlySound(e, rep, pan);
  switch (e.k) {
    // ── attacks ──
    case 'swing': return weaponSwing(weaponKindOf(ab, f) || (ab && !ab.basic ? 'ability' : 'slash'), ab, big, pan);
    case 'fire': return weaponShot(weaponKindOf(ab, f), ab, f, big, pan);
    case 'hit': return hitSound(e, f, ab, rep, big, pan);
    case 'dot': {
      if (!gate('dot', 260)) return cue('dot:gated');
      const k = e.kind || 'burn';
      if (k === 'thorns') tone({ type: 'square', f0: 900, f1: 600, dur: 0.05, vol: 0.08 });
      else if (k === 'poison') tone({ type: 'sine', f0: 240, f1: 180, dur: 0.08, vol: 0.07 });
      else if (k === 'bleed') noise({ dur: 0.05, vol: 0.07, hp: 1500, lp: 5000 });
      else noise({ dur: 0.07, vol: 0.07, hp: 3500, lp: 9000 });
      return cue(`dot:${k}`);
    }
    // ── abilities ──
    case 'cast': {
      if (isUlt || !ab || !(ab.windup >= 0.35) || !gate('cast', 300)) return cue('cast:quiet');
      tone({ type: 'sine', f0: 300, f1: 700, dur: Math.min(0.6, ab.windup), vol: 0.08 });
      return cue('cast:charge');
    }
    case 'burst': {
      if (big || (e.r || 0) >= 160) { sfx.burst(true); return cue('burst:big'); }
      sfx.burst();
      return cue('burst');
    }
    case 'meteor': {
      if (gate('meteor', 200)) { tone({ type: 'sine', f0: 1800, f1: 380, dur: Math.min(1.2, Math.max(0.4, e.delay || 0.7)), vol: 0.12 }); S('fireball', { vol: 0.32, rate: 0.7, duration: 1.2, fade: 0.6, pan }); }
      return cue('meteor');
    }
    case 'zone': { sfx.zone(); if (gate('zone-cast', 300)) S(rot('cast', ['magicCast', 'cast']), { vol: 0.28, rate: 0.8, duration: 0.9, fade: 0.5, pan }); return cue('zone'); }
    case 'dash': {
      if (e.tp) { if (gate('tp', 120) && !S('teleport', { vol: 0.45, rate: vary('tp', 0.05), pan })) sfx.dash(); return cue('dash:teleport'); }
      sfx.dash();
      return cue('dash');
    }
    case 'shield': sfx.shield(); return cue('shield');
    case 'heal': {
      const hp = (f && f.maxHp) || 1000;
      if ((e.v || 0) >= hp * 0.15 && gate('heal-big', 800)) { S('holy', { vol: 0.38, duration: 2, fade: 0.8 }); S('healMagic', { vol: 0.3, duration: 2, fade: 0.8 }); return cue('heal:big'); }
      sfx.heal();
      return cue('heal');
    }
    case 'buff': case 'trait': sfx.buff(); return cue(e.k);
    case 'beam': sfx.beam(); return cue('beam');
    case 'beamend': if (gate('beamend', 200)) tone({ type: 'sawtooth', f0: 600, f1: 200, dur: 0.15, vol: 0.06 }); return cue('beamend');
    case 'trap': sfx.trap(); return cue('trap:set');
    case 'trigger': {
      if (gate('trigger', 150)) { if (!S('trap', { vol: 0.6, rate: vary('trap', 0.05), pan })) sfx.trap(); S('explosion1', { vol: 0.4, at: 0.04, pan, duration: 1.5, fade: 0.6 }); }
      return cue('trap:trigger');
    }
    case 'counter': {
      if (e.ok) { sfx.counter(); crowd('gasp'); return cue('counter:parry'); }
      if (gate('counter-set', 250) && !S('unsheathe', { vol: 0.35, rate: 1.2 })) tone({ type: 'square', f0: 1200, dur: 0.05, vol: 0.1 });
      return cue('counter:stance');
    }
    case 'cleanse': sfx.cleanse(); return cue('cleanse');
    case 'evade': sfx.evade(); return cue('evade');
    case 'slam': sfx.slam(pan); return cue('slam');
    case 'turret': { if (gate('turret', 200) && !S('turret', { vol: 0.45, pan })) arp([300, 450], { step: 0.06, dur: 0.06, vol: 0.14 }); return cue('turret'); }
    case 'interrupt': {
      const had = cancelCharge(e.a, 0.12);
      if (gate('interrupt', 200)) {
        tone({ type: 'sawtooth', f0: had ? 420 : 600, f1: had ? 55 : 120, dur: had ? 0.45 : 0.18, vol: 0.14 });
        noise({ dur: 0.12, vol: 0.12, hp: 1200, lp: 5000 });
        if (had) S('parry', { vol: 0.45, rate: 0.8 });
      }
      return cue(had ? 'interrupt:charge' : 'interrupt');
    }
    case 'cancel': { const had = cancelCharge(e.a, 0.2); return cue(had ? 'cancel:charge' : 'cancel:quiet'); }
    case 'draw': return cue('draw:quiet');
    case 'say': { if (gate('say', 900)) { tone({ type: 'square', f0: 880, dur: 0.03, vol: 0.05 }); tone({ type: 'square', f0: 1175, dur: 0.03, vol: 0.05, at: 0.05 }); } return cue('say'); }
    // ── v4 systems ──
    case 'stance': {
      if (!gate('stance', 250)) return cue('stance:gated');
      const v = Number(e.v) || 0;
      if (v === 1) { tone({ type: 'square', f0: 110, f1: 70, dur: 0.18, vol: 0.2 }); S('unsheathe', { vol: 0.3, rate: 0.9 }); }
      else if (v === 2) { if (!S('parry', { vol: 0.3, rate: 0.7 })) tone({ type: 'square', f0: 300, dur: 0.08, vol: 0.14 }); }
      else if (v === 3) { S('swipe', { vol: 0.35, rate: 1.2 }); tone({ type: 'triangle', f0: 600, f1: 1400, dur: 0.12, vol: 0.1 }); }
      else tone({ type: 'triangle', f0: 520, dur: 0.07, vol: 0.12 });
      return cue(`stance:${['balanced', 'aggressive', 'defensive', 'swift'][v] || v}`);
    }
    case 'swap': { if (gate('swap', 250) && !S('unsheathe', { vol: 0.45, rate: vary('swap', 0.05) })) noise({ dur: 0.2, vol: 0.14, hp: 3000, lp: 9000 }); return cue('swap'); }
    case 'ultready': { if (gate(`ultready${e.a}`, 1200)) { if (!S('chime', { vol: 0.4, rate: 1.15, duration: 1.6, fade: 0.7 })) arp([784, 1047, 1319], { step: 0.06, dur: 0.1, vol: 0.14 }); } return cue('ultready'); }
    case 'divready': { if (gate(`divready${e.a}`, 1500)) { if (!S('arp', { vol: 0.4, duration: 2.2, fade: 0.8 })) arp([523, 784, 1047, 1568], { type: 'triangle', step: 0.08, dur: 0.14, vol: 0.14 }); S('choir', { vol: 0.2, at: 0.1, duration: 2, fade: 1 }); } return cue('divready'); }
    case 'ult': {
      // the charge-up: rooted and exposed for `charge` seconds, then the release (see the top of playEvent)
      const T = clamp(Number(e.charge) || 1, 0.3, 6);
      startCharge(e.a, 'ult', T, { ab: e.ab });
      duck((T + 1.2) * 1000, 0.42);
      S('unsheathe', { vol: 0.4, rate: 0.8, pan, prio: 2 });
      subBoom({ vol: 0.3, len: 0.6, f0: 70, f1: 40 });
      crowd('gasp');
      return cue(`ult:charge:${T.toFixed(1)}`);
    }
    case 'awaken': {
      if (e.v === 'ascend') {
        duck(6500, 0.2);
        S('choir', { vol: 0.65, duration: 5.5, fade: 1.8, prio: 2 });
        S('thunder', { vol: 0.55, at: 0.25, duration: 3.8, fade: 1.4, prio: 2 });
        S('braam', { vol: 0.5, at: 0.45, duration: 4, fade: 1.5, prio: 2 });
        S('holy', { vol: 0.4, at: 0.8, duration: 3.2, fade: 1.2, prio: 2 });
        S('impactCine', { vol: 0.5, at: 0.45, duration: 3.5, fade: 1.2, prio: 2 });
        subBoom({ vol: 0.6, len: 1.4, f0: 80, f1: 26, at: 0.45 });
        if (!buffers.choir) arp([262, 392, 523, 784, 1047], { type: 'sawtooth', step: 0.12, dur: 0.35, vol: 0.16 });
        crowd('cheer', true);
        return cue('awaken:ascend');
      }
      duck(3500, 0.3);
      if (!S('awaken', { vol: 0.6, prio: 2 })) arp([220, 330, 440, 660, 880], { step: 0.07, dur: 0.12, vol: 0.2 });
      S('braam', { vol: 0.38, at: 0.25, duration: 2.8, fade: 1, prio: 2 });
      S('shout', { vol: 0.35, at: 0.1, rate: 0.9 });
      subBoom({ vol: 0.45, len: 0.9, at: 0.25 });
      crowd('gasp', true);
      return cue('awaken');
    }
    case 'relic': {
      if (!gate(`relic${e.a}`, 400)) return cue('relic:gated');
      const id = String(e.id || '').toLowerCase();
      if (/phoenix|feather|rebirth/.test(id)) S('holy', { vol: 0.4, duration: 2.2, fade: 0.8 });
      else if (/thunder|idol|storm/.test(id)) S('thunder', { vol: 0.35, duration: 2, fade: 0.8 });
      else if (/vampire|fang|blood/.test(id)) tone({ type: 'sine', f0: 250, f1: 900, dur: 0.35, vol: 0.14 });
      else if (/hourglass|clock|time/.test(id)) { tone({ type: 'square', f0: 1200, dur: 0.03, vol: 0.1 }); tone({ type: 'square', f0: 900, dur: 0.03, vol: 0.1, at: 0.15 }); S('chime', { vol: 0.3, rate: 0.8, duration: 1.2, fade: 0.5 }); }
      else if (!S('chime', { vol: 0.4, rate: vary('relic', 0.06), duration: 1.5, fade: 0.6 })) arp([988, 1319], { type: 'triangle', step: 0.07, dur: 0.12, vol: 0.14 });
      return cue(`relic:${id || '?'}`);
    }
    case 'revive': {
      duck(4000, 0.3);
      if (!S('holy', { vol: 0.6, duration: 3.5, fade: 1.2, prio: 2 })) arp([523, 659, 784, 1047, 1319], { type: 'triangle', step: 0.09, dur: 0.18, vol: 0.2 });
      S('choir', { vol: 0.35, at: 0.2, duration: 3, fade: 1.2, prio: 2 });
      crowd('cheer', true);
      return cue('revive');
    }
    case 'emote': {
      const v = EMOTE[e.v] ? e.v : 'taunt';
      if (gate(`emote${e.a}`, 700)) EMOTE[v]();
      return cue(`emote:${v}`);
    }
    case 'impact': {
      const k = e.kind || 'big';
      if (k === 'ko') return cue('impact:ko:byko'); // the 'ko' event right after plays the K.O.
      if (!gate('impact', 120)) return cue(`impact:${k}:gated`);
      const tier = k === 'ult' || k === 'god' ? 3 : 2;
      // the hit's own stack usually just played: add only the tail + sub, else the full stack
      if (performance.now() - lastStack.at < 150 && lastStack.tier >= 1) {
        S(tier >= 3 ? 'impactCine' : 'boom', { vol: tier >= 3 ? 0.6 : 0.5, rate: vary('impact', 0.04), duration: tier >= 3 ? 3.4 : 2, fade: 0.9, prio: 2 });
        subBoom({ vol: tier >= 3 ? 0.6 : 0.42, len: tier >= 3 ? 1 : 0.6, f0: 95, f1: 30 });
        duck(tier >= 3 ? 1200 : 600, tier >= 3 ? 0.28 : 0.42);
      } else stack(tier, { pan });
      if (k === 'god') S(rot('thunder', ['godThunder', 'thunder']), { vol: 0.5, at: 0.05, duration: 3, fade: 1.2, prio: 2 });
      if (k === 'crit') sfx.crit();
      crowd('gasp', tier >= 3);
      return cue(`impact:${k}`);
    }
    case 'god': {
      // the godly cast: choir + a riser of exactly `cast` seconds; g:fire plays the power's signature
      const T = clamp(Number(e.cast) || 0.6, 0.25, 4);
      duck((T + 3.5) * 1000, 0.2);
      startCharge(e.a, 'god', T, { id: e.id });
      if (!S('choir', { vol: 0.55, duration: T + 2.5, fade: 1.4, prio: 2 })) arp([262, 330, 392, 523, 659, 784], { type: 'sawtooth', step: 0.1, dur: 0.4, vol: 0.14 });
      S('braam', { vol: 0.38, duration: T + 2, fade: 1.2, prio: 2 });
      subBoom({ vol: 0.4, len: T + 0.3, f0: 60, f1: 38 });
      crowd('gasp', true);
      return cue(`god:${e.id || '?'}`);
    }
    case 'ko': {
      cancelCharge(e.a, 0.1);
      sfx.ko(pan);
      return cue('ko');
    }
    default: return cue(`unknown:${e.k}`);
  }
}

// ── game modes: army + business ─────────────────────────────────────────────
function blip() { tone({ type: 'triangle', f0: 880, f1: 990, dur: 0.05, vol: 0.08 }); }
const sidePan = (e) => (e && e.side === 0 ? -0.3 : e && e.side === 1 ? 0.3 : 0);
let sales = [];

const ARMY = {
  horn(big) {
    duck(4200, 0.32);
    if (!S('armyHorn', { vol: 0.85, prio: 2, duration: 4, fade: 1.2 })) {
      tone({ type: 'sawtooth', f0: 147, dur: 1.4, vol: 0.2, attack: 0.08 });
      tone({ type: 'sawtooth', f0: 220, dur: 1.4, vol: 0.14, attack: 0.08, at: 0.05 });
    }
    subBoom({ vol: 0.4, len: 0.9, f0: 70, f1: 40 });
    if (big) S('armyBattlecry', { vol: 0.6, at: 0.9, duration: 3, fade: 1, prio: 2 });
    return 'horn';
  },
  march(big, pan) {
    if (!gate('army-march', 1500)) return 'march:gated';
    if (!S('armyMarch', { vol: big ? 0.55 : 0.42, pan, duration: 3.6, fade: 1.2 })) [0, 0.3, 0.6, 0.9].forEach(at => tone({ type: 'sine', f0: 90, f1: 60, dur: 0.12, vol: 0.25, at }));
    return 'march';
  },
  clash(big, pan) {
    if (!gate('army-clash', 110)) return 'clash:gated';
    if (!S('armyClash', { vol: big ? 0.75 : 0.5, rate: vary('army-clash', 0.08), pan, duration: big ? 2.8 : 1.6, fade: 0.7 })) S(rot('block', ['clang', 'parry', 'block']), { vol: 0.5, rate: vary('army-clang', 0.08), pan });
    stack(big ? 2 : 0, { blade: true, pan, vol: big ? 0.8 : 0.5 });
    return 'clash';
  },
  volley(big, pan) {
    if (!gate('army-volley', 250)) return 'volley:gated';
    if (!S('armyVolley', { vol: big ? 0.7 : 0.55, rate: vary('army-volley', 0.05), pan, duration: 3, fade: 1 })) [0, 0.05, 0.11, 0.18].forEach(at => S('bow', { vol: 0.35, rate: vary('army-bow', 0.1), at, pan }));
    return 'volley';
  },
  charge(big, pan) {
    if (!gate('army-charge', 1200)) return 'charge:gated';
    duck(2500, 0.45);
    if (!S('armyCharge', { vol: big ? 0.8 : 0.62, pan, duration: 4, fade: 1.3, prio: 2 })) [0, 0.18, 0.36, 0.54, 0.72].forEach(at => tone({ type: 'sine', f0: 110, f1: 70, dur: 0.1, vol: 0.25, at }));
    if (big) S('armyBattlecry', { vol: 0.55, at: 0.2, duration: 3, fade: 1, prio: 2 });
    return 'charge';
  },
  siege(big, pan) {
    if (!gate('army-siege', 200)) return 'siege:gated';
    if (!S('armySiege', { vol: 0.75, pan, duration: 3, fade: 1, prio: 2 })) S('bomb', { vol: 0.6, pan });
    S(rot('army-expl', EXPLOSIONS), { vol: big ? 0.8 : 0.55, at: 0.85, rate: vary('army-siege', 0.06), pan, duration: 2.5, fade: 1, prio: 2 });
    subBoom({ vol: big ? 0.6 : 0.42, len: 0.8, at: 0.85, f0: 90, f1: 30 });
    if (big) duck(1500, 0.4);
    return 'siege';
  },
  spell(big, pan) {
    if (!gate('army-spell', 150)) return 'spell:gated';
    if (!S(rot('cast', ['magicCast', 'cast']), { vol: 0.45, rate: vary('army-spell', 0.06), pan, duration: 1.5, fade: 0.5 })) sfx.shoot();
    if (big) release(2, pan);
    return 'spell';
  },
  heal(big, pan) {
    if (!gate('army-heal', 300)) return 'heal:gated';
    if (!S(buffers.healMagic ? 'healMagic' : 'heal', { vol: big ? 0.5 : 0.36, pan, duration: 2.2, fade: 0.8 })) arp([523, 659, 784], { type: 'triangle', step: 0.06, dur: 0.12, vol: 0.18 });
    return 'heal';
  },
  death(big, pan) {
    if (!gate('army-death', 160)) return 'death:gated';
    if (!S(rot('army-death', ['armyDeath1', 'armyDeath2']), { vol: big ? 0.55 : 0.4, rate: vary('army-death', 0.1), pan })) tone({ type: 'sawtooth', f0: 300, f1: 120, dur: 0.25, vol: 0.12 });
    if (big) S('bodyfall', { vol: 0.55, at: 0.25, pan });
    return 'death';
  },
  rout(big, pan) {
    if (!gate('army-rout', 1500)) return 'rout:gated';
    S('armyRout', { vol: big ? 0.7 : 0.55, pan, duration: 3.6, fade: 1.2, prio: 2 });
    if (!S('armyHorn', { vol: 0.35, rate: 0.82, at: 0.3, duration: 2.2, fade: 0.9 })) tone({ type: 'sawtooth', f0: 196, f1: 147, dur: 1, vol: 0.14, at: 0.3 });
    return 'rout';
  },
  general(big, pan) {
    duck(3500, 0.25);
    stack(3, { pan });
    S('armyHorn', { vol: 0.42, rate: 0.7, at: 0.45, duration: 2.8, fade: 1.1, prio: 2 });
    S('epicHit', { vol: 0.45, at: 0.1, duration: 3.5, fade: 1.2, prio: 2 });
    return 'general';
  },
  victory() {
    lastSting = performance.now();
    duck(6500, 0.22);
    if (!S('armyVictory', { vol: 0.75, prio: 2, duration: 5, fade: 1.6 })) crowd('cheer', true);
    S('victorySting', { vol: 0.6, at: 0.2, prio: 2 }) || S('fanfare', { vol: 0.6, at: 0.2, prio: 2 });
    S('armyHorn', { vol: 0.45, duration: 3, fade: 1.2, prio: 2 });
    return 'victory';
  },
};

// Modern Warfare: gunfire, armour, artillery, air power, the command posts' support powers.
const WAR = {
  start() {
    duck(5000, 0.3);
    if (!S('warSiren', { vol: 0.55, prio: 2, duration: 5, fade: 1.8 })) { tone({ type: 'sawtooth', f0: 320, f1: 720, dur: 1.6, vol: 0.12 }); tone({ type: 'sawtooth', f0: 720, f1: 320, dur: 1.6, vol: 0.12, at: 1.6 }); }
    subBoom({ vol: 0.35, len: 1.1, f0: 70, f1: 34, at: 0.3 });
    return 'start';
  },
  rifle(big, pan) {
    if (!gate('war-rifle', 280)) return 'rifle:gated';
    if (!S('warRifle', { vol: big ? 0.42 : 0.3, rate: vary('war-rifle', 0.09), pan, offset: 0.02, duration: 1.2, fade: 0.45 })) S('gun', { vol: 0.3, rate: vary('war-gun', 0.1), pan });
    return 'rifle';
  },
  mg(big, pan) {
    if (!gate('war-mg', 420)) return 'mg:gated';
    if (!S('warMg', { vol: big ? 0.5 : 0.38, rate: vary('war-mg', 0.06), pan, duration: 1.5, fade: 0.5 })) [0, 0.07, 0.14, 0.21].forEach(at => noise({ dur: 0.04, vol: 0.12, at, hp: 900 }));
    return 'mg';
  },
  sniper(big, pan) {
    if (!gate('war-sniper', 400)) return 'sniper:gated';
    S('warRifle', { vol: 0.35, rate: 0.72, pan, duration: 0.9, fade: 0.5 });
    return 'sniper';
  },
  cannon(big, pan) {
    if (!gate('war-cannon', 170)) return 'cannon:gated';
    if (!S('warCannon', { vol: big ? 0.62 : 0.48, rate: vary('war-cannon', 0.07), pan, duration: 2.4, fade: 1 })) S('bomb', { vol: 0.4, pan });
    subBoom({ vol: big ? 0.38 : 0.22, len: 0.45, f0: 95, f1: 40 });
    return 'cannon';
  },
  rocket(big, pan) {
    if (!gate('war-rocket', 220)) return 'rocket:gated';
    if (!S('warRocket', { vol: 0.42, rate: vary('war-rocket', 0.08), pan, duration: 1.5, fade: 0.6 })) S('whoosh1', { vol: 0.4, rate: 0.8, pan });
    return 'rocket';
  },
  missile(big, pan) {
    if (!gate('war-missile', 260)) return 'missile:gated';
    if (!S('warRocket', { vol: big ? 0.5 : 0.34, rate: 1.18 * vary('war-missile', 0.06), pan, duration: 1.3, fade: 0.6 })) S('whoosh2', { vol: 0.35, pan });
    return 'missile';
  },
  torpedo(big, pan) {
    if (!gate('war-torpedo', 500)) return 'torpedo:gated';
    S('whoosh3', { vol: 0.32, rate: 0.55, pan, lp: 900 });
    subBoom({ vol: 0.25, len: 0.6, f0: 60, f1: 30 });
    return 'torpedo';
  },
  artillery(big, pan) {
    if (!gate('war-arty', 300)) return 'artillery:gated';
    if (!S('warArtillery', { vol: big ? 0.6 : 0.46, rate: vary('war-arty', 0.07), pan, duration: 3, fade: 1.2 })) S('armySiege', { vol: 0.5, pan, duration: 2, fade: 0.8 });
    return 'artillery';
  },
  naval(big, pan) {
    if (!gate('war-naval', 300)) return 'naval:gated';
    S('warArtillery', { vol: big ? 0.66 : 0.52, rate: 0.84 * vary('war-naval', 0.05), pan, duration: 3.2, fade: 1.2, prio: big ? 2 : 1 });
    subBoom({ vol: big ? 0.5 : 0.3, len: 0.9, f0: 70, f1: 30 });
    return 'naval';
  },
  bombdrop(big, pan) {
    if (!gate('war-bombdrop', 500)) return 'bombdrop:gated';
    S('whoosh3', { vol: 0.22, rate: 0.62, pan });
    return 'bombdrop';
  },
  explosion(big, pan) {
    if (!gate('war-expl', 110)) return 'explosion:gated';
    const ok = S(big ? 'warBigBoom' : 'warExplosion', { vol: big ? 0.72 : 0.5, rate: vary('war-expl', 0.09), pan, duration: big ? 3 : 2, fade: 1, prio: big ? 2 : 1 });
    if (!ok) S(rot('war-expl', EXPLOSIONS), { vol: big ? 0.7 : 0.5, rate: vary('war-expl2', 0.08), pan, duration: 2, fade: 0.8 });
    subBoom({ vol: big ? 0.55 : 0.28, len: big ? 1 : 0.5, f0: 80, f1: 28 });
    if (big) duck(1200, 0.5);
    return 'explosion';
  },
  wreck(big, pan) {
    if (!gate('war-wreck', 300)) return 'wreck:gated';
    S(rot('war-wreck', EXPLOSIONS), { vol: big ? 0.55 : 0.4, rate: 0.9 * vary('war-wreck', 0.08), pan, duration: 2, fade: 0.8 });
    return 'wreck';
  },
  shotdown(big, pan) {
    if (!gate('war-shotdown', 400)) return 'shotdown:gated';
    S('warJet', { vol: 0.32, rate: 0.78, pan, offset: 1.2, duration: 1.6, fade: 1 });
    S('warExplosion', { vol: 0.55, at: 0.9, pan, duration: 2, fade: 0.8 });
    subBoom({ vol: 0.35, len: 0.7, at: 0.9 });
    return 'shotdown';
  },
  destroyed(big, pan) {
    if (!gate('war-destroyed', 400)) return 'destroyed:gated';
    S('warBigBoom', { vol: 0.5, rate: vary('war-destroyed', 0.08), pan, duration: 2.6, fade: 1 });
    return 'destroyed';
  },
  hq() {
    duck(4500, 0.25);
    S('warBigBoom', { vol: 0.9, prio: 2, duration: 3.5, fade: 1.2 });
    S('impactCine', { vol: 0.6, at: 0.15, prio: 2 });
    subBoom({ vol: 0.75, len: 1.6, f0: 70, f1: 24 });
    return 'hq';
  },
  retreat(big, pan) {
    if (!gate('war-retreat', 1200)) return 'retreat:gated';
    S('armyRout', { vol: big ? 0.45 : 0.32, pan, duration: 2.6, fade: 1 });
    return 'retreat';
  },
  rally(big, pan) {
    if (!gate('war-rally', 1500)) return 'rally:gated';
    if (!S('armyHorn', { vol: 0.32, rate: 1.12, pan, duration: 2.2, fade: 0.9 })) tone({ type: 'square', f0: 523, dur: 0.3, vol: 0.1 });
    return 'rally';
  },
  assault(big, pan) {
    if (!gate('war-assault', 700)) return 'assault:gated';
    S('shout', { vol: 0.3, rate: vary('war-assault', 0.12), pan });
    return 'assault';
  },
  jet(big, pan) {
    if (!gate('war-jet', 1400)) return 'jet:gated';
    S('warJet', { vol: big ? 0.52 : 0.36, rate: vary('war-jet', 0.05), pan, duration: 4.5, fade: 1.6 });
    return 'jet';
  },
  smoke() {
    if (!gate('war-smoke', 800)) return 'smoke:gated';
    noise({ dur: 0.7, vol: 0.14, hp: 500, lp: 3500 });
    noise({ dur: 0.5, vol: 0.1, hp: 700, lp: 4000, at: 0.25 });
    return 'smoke';
  },
  power(big, pan, e) {
    const p = e && e.p;
    duck(2500, 0.4);
    if (p === 'cruise') S('warCruise', { vol: 0.62, prio: 2, duration: 5, fade: 1.6 });
    else if (p === 'carpet' || p === 'airstrike') { S('warSiren', { vol: 0.38, prio: 2, duration: 3.2, fade: 1.2 }); S('warJet', { vol: 0.45, at: 1.2, prio: 2, duration: 4, fade: 1.5 }); }
    else if (p === 'barrage') { S('warArtillery', { vol: 0.5, rate: 0.9, duration: 3, fade: 1.2 }); S('warArtillery', { vol: 0.42, rate: 1.05, at: 0.4, duration: 3, fade: 1.2 }); }
    else if (p === 'emp') { if (!S('beam', { vol: 0.5, rate: 0.7, duration: 2, fade: 0.8, prio: 2 })) tone({ type: 'sawtooth', f0: 1200, f1: 80, dur: 0.8, vol: 0.18 }); subBoom({ vol: 0.5, len: 1 }); }
    else if (!S('ping', { vol: 0.5, rate: 0.8 })) tone({ type: 'square', f0: 880, dur: 0.08, vol: 0.12 });
    return `power:${p || '?'}`;
  },
  victory() {
    duck(6000, 0.3);
    if (!S('armyVictory', { vol: 0.7, prio: 2, duration: 6, fade: 2 })) S('victorySting', { vol: 0.7, prio: 2 });
    return 'victory';
  },
};

const BIZ = {
  bell() {
    if (!gate('biz-bell', 800)) return 'bell:gated';
    duck(2200, 0.45);
    if (!S('bizBell', { vol: 0.62, duration: 3, fade: 1, prio: 2 }) && !S('bell', { vol: 0.55, duration: 2.4, fade: 1 })) arp([1319, 1319], { step: 0.25, dur: 0.2, vol: 0.14 });
    return 'bell';
  },
  sale(big, pan) {
    // sales come in floods: at most ~6 per second, and quieter the busier it gets
    const now = performance.now();
    sales = sales.filter(t => now - t < 1000);
    if (!gate('biz-sale', 150) || sales.length >= 6) return 'sale:throttled';
    sales.push(now);
    const v = (big ? 0.5 : 0.36) / Math.sqrt(sales.length);
    if (!S('bizSale', { vol: v, rate: vary('biz-sale', 0.06), pan, duration: 1.2, fade: 0.4 }) && !S('coin', { vol: v, rate: vary('biz-coin', 0.08), pan })) tone({ type: 'square', f0: 1320, f1: 1760, dur: 0.05, vol: 0.1 });
    return 'sale';
  },
  cash(big, pan) {
    if (!gate('biz-cash', 300)) return 'cash:gated';
    if (!S('bizCash', { vol: big ? 0.6 : 0.45, pan, duration: 2, fade: 0.6 }) && !S('coin', { vol: 0.5, pan })) arp([988, 1319, 1568], { step: 0.05, dur: 0.06, vol: 0.12 });
    return 'cash';
  },
  open(big, pan) {
    if (!gate('biz-open', 300)) return 'open:gated';
    if (!S('bizOpen', { vol: 0.5, pan, duration: 2, fade: 0.6 }) && !S('uiConfirm', { vol: 0.45, pan })) arp([784, 1047], { type: 'triangle', step: 0.08, dur: 0.1, vol: 0.14 });
    return 'open';
  },
  close(big, pan) {
    if (!gate('biz-close', 300)) return 'close:gated';
    if (!S('bizClose', { vol: 0.5, pan, duration: 2.5, fade: 0.8 })) { noise({ dur: 0.5, vol: 0.14, hp: 300, lp: 3000 }); tone({ type: 'square', f0: 140, dur: 0.06, vol: 0.14, at: 0.5 }); }
    return 'close';
  },
  launch(big, pan) {
    if (!gate('biz-launch', 500)) return 'launch:gated';
    duck(1800, 0.5);
    if (!S('bizLaunch', { vol: big ? 0.7 : 0.58, pan, duration: 2.5, fade: 0.8, prio: 2 })) arp([523, 659, 784, 1047], { step: 0.05, dur: 0.08, vol: 0.16 });
    if (big) S('crowdApplause', { vol: 0.32, at: 0.35, duration: 3, fade: 1.2 });
    return 'launch';
  },
  price(big, pan) {
    if (!gate('biz-price', 120)) return 'price:gated';
    if (!S('bizPrice', { vol: 0.34, rate: vary('biz-price', 0.06), pan, duration: 1, fade: 0.3 })) tone({ type: 'square', f0: 1100, dur: 0.03, vol: 0.08 });
    return 'price';
  },
  hire(big, pan) {
    if (!gate('biz-hire', 200)) return 'hire:gated';
    if (!S('bizHire', { vol: 0.5, rate: vary('biz-hire', 0.05), pan, duration: 1, fade: 0.3 })) { tone({ type: 'square', f0: 180, f1: 90, dur: 0.08, vol: 0.2 }); noise({ dur: 0.06, vol: 0.14, hp: 400, lp: 3000 }); }
    return 'hire';
  },
  marketing(big, pan) {
    if (!gate('biz-marketing', 500)) return 'marketing:gated';
    if (!S('bizMarketing', { vol: 0.5, pan, duration: 2.5, fade: 0.8 })) arp([659, 880, 659, 880], { step: 0.08, dur: 0.07, vol: 0.12 });
    return 'marketing';
  },
  milestone(big) {
    if (!gate('biz-milestone', 600)) return 'milestone:gated';
    duck(2200, 0.45);
    if (!S('bizMilestone', { vol: 0.62, duration: 2.5, fade: 0.8, prio: 2 }) && !S('jingleWin', { vol: 0.5, duration: 2.5, fade: 0.8 })) arp([523, 659, 784, 1047], { step: 0.08, dur: 0.1, vol: 0.18 });
    if (big) S('crowdApplause', { vol: 0.35, at: 0.25, duration: 3, fade: 1.2 });
    return 'milestone';
  },
  news() {
    if (!gate('biz-news', 800)) return 'news:gated';
    duck(2600, 0.4);
    if (!S('bizNews', { vol: 0.55, duration: 3, fade: 0.8, prio: 2 })) arp([880, 880, 1175], { step: 0.12, dur: 0.1, vol: 0.14 });
    return 'news';
  },
  bankrupt(big, pan) {
    duck(3600, 0.3);
    if (!S('bizBankrupt', { vol: 0.7, pan, duration: 3, fade: 0.8, prio: 2 }) && !S('jingleLose', { vol: 0.5, duration: 2.8, fade: 0.8 })) arp([392, 370, 349, 330], { type: 'triangle', step: 0.2, dur: 0.22, vol: 0.2 });
    S('groan', { vol: 0.32, at: 0.5, duration: 3, fade: 1.2 });
    return 'bankrupt';
  },
  victory() {
    lastSting = performance.now();
    duck(6500, 0.22);
    S('bizVictory', { vol: 0.72, prio: 2, duration: 4, fade: 1.2 }) || S('jingleWin', { vol: 0.55, prio: 2 });
    S('victorySting', { vol: 0.55, at: 0.3, prio: 2 });
    S('crowdApplause', { vol: 0.4, at: 0.5, duration: 5, fade: 1.8, prio: 2 }) || S('cheer', { vol: 0.4, at: 0.5, duration: 5, fade: 1.8, prio: 2 });
    return 'victory';
  },
};

/**
 * Sounds for the game modes. modeEvent(mode, e) with e = { k, side, big }:
 *  army:     horn (battle start) · march · clash (melee contact) · volley (arrows) · charge (cavalry) ·
 *            siege (catapult / cannon) · spell · heal · death · rout (a squad flees) · general (a general falls) · victory
 *  business: bell (market opens / new day) · sale (throttled) · cash · open (store opens) · close · launch (product) ·
 *            price (price change) · hire · marketing · milestone · news · bankrupt · victory
 *  war:      start (air-raid siren) · rifle · mg · sniper · cannon · rocket · missile · torpedo · artillery · naval ·
 *            bombdrop · explosion · wreck · shotdown · destroyed · hq (a command post falls) · retreat · rally ·
 *            assault · jet · smoke · power (e.p = rally | smoke | barrage | airstrike | cruise | emp | carpet) · victory
 * `side` (0 / 1) pans the sound a little toward that side; `big` picks the bigger variant.
 * Unknown kinds (or modes) → a soft blip. Returns the cue name.
 */
export function modeEvent(mode, e = {}) {
  const k = String((e && e.k) || '');
  const table = mode === 'army' ? ARMY : mode === 'business' ? BIZ : mode === 'war' ? WAR : null;
  const fn = table && Object.prototype.hasOwnProperty.call(table, k) ? table[k] : null;
  if (!fn) {
    if (gate(`mode-blip-${mode}`, 120)) blip();
    return cue(`${mode}:${k || '?'}:blip`);
  }
  return cue(`${mode}:${fn(!!(e && e.big), sidePan(e), e || {}) || k}`);
}

// ── interface sounds ────────────────────────────────────────────────────────
/**
 * ui(name, arg): 'tab' · 'open' · 'close' · 'click' · 'lock' (lock-in) · 'ready' · 'autolock' ·
 * 'levelup' (arg = new level; 5, 8, 10, 12 are bigger) · 'clock60' · 'tick' (arg = seconds left) ·
 * 'timeup' · 'message' · 'save' · 'testwin' · 'testloss' · 'testdraw' · 'predict' · 'matchover' ·
 * 'newmatch' · 'error'. Returns the cue name.
 */
export function ui(name, arg) {
  switch (name) {
    case 'tab': if (gate('ui-tab', 60) && !S('uiClick', { vol: 0.28, rate: vary('ui-tab', 0.04) })) tone({ type: 'square', f0: 700, dur: 0.03, vol: 0.08 }); break;
    case 'open': if (gate('ui-open', 80) && !S('uiOpen', { vol: 0.35 })) tone({ type: 'triangle', f0: 500, f1: 900, dur: 0.06, vol: 0.1 }); break;
    case 'close': if (gate('ui-open', 80) && !S('uiOpen', { vol: 0.3, rate: 0.8 })) tone({ type: 'triangle', f0: 900, f1: 500, dur: 0.06, vol: 0.1 }); break;
    case 'click': sfx.click(); break;
    case 'lock': case 'lockin': if (!S('uiConfirm', { vol: 0.45 })) tone({ type: 'square', f0: 500, dur: 0.05, vol: 0.12 }); S('coin', { vol: 0.4, at: 0.06 }); break;
    case 'ready': sfx.ready(); break;
    case 'autolock': sfx.alarm(); break;
    case 'levelup': {
      const lv = Number(arg) || 0;
      if (lv >= 12) { duck(6000, 0.2); S('choir', { vol: 0.6, duration: 5, fade: 1.5, prio: 2 }); S('thunder', { vol: 0.45, at: 0.2, duration: 3.5, fade: 1.2, prio: 2 }); subBoom({ vol: 0.5, len: 1.2, at: 0.5 }); if (!S('epicHit', { vol: 0.55, at: 0.5, duration: 4.5, fade: 1.5, prio: 2 })) arp([523, 659, 784, 1047, 1319, 1568], { step: 0.08, dur: 0.14, vol: 0.2 }); }
      else if (lv === 10) { duck(5000, 0.25); S('choir', { vol: 0.55, duration: 4.5, fade: 1.5, prio: 2 }); S('gong', { vol: 0.5, at: 0.15, duration: 3.5, fade: 1.2, prio: 2 }); if (!S('arp', { vol: 0.45, at: 0.3, prio: 2 })) arp([523, 659, 784, 1047, 1319], { step: 0.07, dur: 0.12, vol: 0.2 }); }
      else if (lv === 8) { duck(3500, 0.3); S('braam', { vol: 0.35, duration: 3, fade: 1, prio: 2 }); if (!S('arp', { vol: 0.5, at: 0.1, prio: 2 })) sfx.levelUpSmall(); }
      else if (lv === 5) { duck(2500, 0.35); if (!S('arp', { vol: 0.5, prio: 2 })) sfx.levelUpSmall(); S('levelup', { vol: 0.45, at: 0.2 }); }
      else sfx.levelUpSmall();
      return cue(`ui:levelup:${lv >= 12 ? 'godhood' : lv === 10 ? 'godly' : lv === 8 || lv === 5 ? 'big' : 'normal'}`);
    }
    case 'clock60': sfx.alarm(); break;
    case 'tick': {
      const s = Number(arg);
      if (s > 0 && s <= 3) tone({ type: 'square', f0: 1320, dur: 0.06, vol: 0.18 });
      else sfx.tick();
      break;
    }
    case 'timeup': sfx.alarm(); S('bell', { vol: 0.5, at: 0.25, duration: 2, fade: 1 }); break;
    case 'message': if (gate('ui-msg', 400) && !S('ping', { vol: 0.3, rate: vary('ping', 0.03) })) arp([1175, 1568], { type: 'triangle', step: 0.07, dur: 0.08, vol: 0.1 }); break;
    case 'save': sfx.save(); break;
    case 'testwin': if (!S('jingleWin', { vol: 0.45, duration: 2.6, fade: 0.8 })) arp([523, 659, 784, 1047], { step: 0.08, dur: 0.1, vol: 0.18 }); break;
    case 'testloss': if (!S('jingleLose', { vol: 0.4, duration: 2.8, fade: 0.8 })) arp([392, 349, 311, 262], { type: 'triangle', step: 0.14, dur: 0.16, vol: 0.18 }); break;
    case 'testdraw': if (!S('fall', { vol: 0.45 })) arp([440, 440], { step: 0.15, dur: 0.1, vol: 0.14 }); break;
    case 'predict': if (!S('coin', { vol: 0.45, rate: 1.1 })) arp([880, 1320], { step: 0.06, dur: 0.07, vol: 0.14 }); break;
    case 'matchover': {
      // the final round's victory sting may have just played: then only gong + crowd
      if (performance.now() - lastSting < 7000) { S('gong', { vol: 0.45, at: 1.2, duration: 3.5, fade: 1.2, prio: 2 }); break; }
      lastSting = performance.now();
      duck(6000, 0.25);
      if (!S('victorySting', { vol: 0.65, prio: 2 })) sfx.victory();
      S(buffers.crowdRoar ? 'crowdRoar' : 'cheer', { vol: 0.45, at: 0.4, duration: 5, fade: 2, prio: 2 });
      break;
    }
    case 'newmatch': if (!S('gong', { vol: 0.5, duration: 3.5, fade: 1.2, prio: 2 })) tone({ type: 'sine', f0: 196, f1: 180, dur: 1.2, vol: 0.3 }); break;
    case 'error': if (!S('jingleLose', { vol: 0.25, rate: 1.4, duration: 0.8, fade: 0.3 })) tone({ type: 'square', f0: 220, dur: 0.12, vol: 0.14 }); break;
    default: return cue(`ui:unknown:${name}`);
  }
  return cue(`ui:${name}`);
}

// ── status + verification ───────────────────────────────────────────────────
/** What loaded: samples (decoded buffers), songs (the <audio> elements used so far), the current song. */
export function soundStatus() {
  const names = Object.keys(SAMPLES);
  return {
    context: ctx ? ctx.state : 'none',
    samples: {
      total: names.length, requested: samplesRequested,
      loaded: names.filter(n => buffers[n]).length,
      pending: names.filter(n => !buffers[n] && !failed[n]).length,
      failed: Object.assign({}, failed),
    },
    tracks: {
      total: Object.keys(TRACKS).length,
      families: Object.fromEntries(Object.keys(FAMILIES).map(fm => [fm, famTracks(fm).length])),
      ok: Object.keys(trackState).filter(t => trackState[t] === 'ok'),
      failed: Object.keys(trackState).filter(t => trackState[t] === 'error'),
    },
    music: { want: wantTrack, playing: Object.keys(players).filter(n => !players[n].paused) },
    voices,
  };
}

/**
 * Fetch + decode every sample and song (one at a time; nothing is played). For tests / diagnostics.
 * Resolves to { ok, failed: [{ name, url, error }], samples, tracks, seconds: { name: duration } }.
 */
export async function verifyAudio({ samples = true, tracks = true } = {}) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const dec = new OAC(2, 44100, 44100);
  const jobs = [];
  if (samples) for (const [n, u] of Object.entries(SAMPLES)) jobs.push([n, u]);
  if (tracks) for (const [n, u] of Object.entries(TRACKS)) jobs.push([`music:${n}`, u]);
  const out = { ok: 0, failed: [], samples: samples ? Object.keys(SAMPLES).length : 0, tracks: tracks ? Object.keys(TRACKS).length : 0, seconds: {} };
  for (const [name, url] of jobs) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ab = await r.arrayBuffer();
      const buf = await new Promise((res, rej) => dec.decodeAudioData(ab, res, rej));
      if (!buf || !(buf.duration > 0)) throw new Error('empty');
      out.seconds[name] = Math.round(buf.duration * 100) / 100;
      out.ok++;
    } catch (err) {
      out.failed.push({ name, url, error: String((err && err.message) || err || 'decode error') });
    }
  }
  return out;
}
