// Army Battle — tiny pixel-art sprites for every unit type (facing right), built per army
// colour into small canvases. Keys: P primary, p primary shade, Q primary light, S secondary,
// everything else is a fixed palette colour. '.' is transparent.

const BASE = {
  o: '#1b1a22', k: '#e8b48a', K: '#b27a52', m: '#d4dbe6', M: '#7c8696', w: '#9a6a3a', W: '#5c3a1c',
  b: '#3a2e2a', l: '#7a5230', g: '#ffd35a', G: '#b8862a', h: '#8a5a34', H: '#553620', n: '#2a1a12',
  c: '#ece8dc', C: '#a8a090', f: '#ff9a30', F: '#fff4b0', t: '#6f9a4c', T: '#44602e', y: '#c89a5a', Y: '#f0e2bc',
  s: '#a39d8f', e: '#6c665a', a: '#f6f6ff', A: '#b8c2e0', r: '#b8342a', x: '#5a5a66', i: '#8fd8ff', d: '#2c2a30',
};

// [frame0, frame1]; anchor = [x, y] of the feet (bottom centre) in sprite pixels.
export const SPRITES = {
  infantry: { anchor: [2, 8], frames: [
    ['.MM...', '.Mkk..', 'SPPPm.', 'SpPPm.', '.pPP..', '.bbb..', '.b.b..', '.b.b..'],
    ['.MM...', '.Mkk..', 'SPPPmm', 'SpPP..', '.pPP..', '.bbb..', '.b..b.', 'b...b.'],
  ] },
  archers: { anchor: [2, 8], frames: [
    ['.pp...', '.pkk.w', '.PPPkw', '.PPP.w', '.pPP.w', '.lll..', '.b.b..', '.b.b..'],
    ['.pp...', '.pkk.w', 'kPPP.w', '.PPPkw', '.pPP.w', '.lll..', '.b..b.', 'b...b.'],
  ] },
  spearmen: { anchor: [2, 10], frames: [
    ['....m...', '....w...', '.MM.w...', '.Mkkw...', 'SPPPk...', 'SpPPw...', '.pPPw...', '.bbb....', '.b.b....', '.b.b....'],
    ['........', '........', '.MM.....', '.Mkk....', 'SPPPkwwm', 'SpPP....', '.pPP....', '.bbb....', '.b..b...', 'b...b...'],
  ] },
  shieldwall: { anchor: [2, 8], frames: [
    ['.MM....', '.MkkS..', '.PPSSS.', '.pPSgS.', '.pPSSS.', '.bbSSS.', '.b.bS..', '.b.b...'],
    ['.MM....', '.MkkS..', '.PPSSSm', '.pPSgS.', '.pPSSS.', '.bbSSS.', '.b..S..', 'b...b..'],
  ] },
  cavalry: { anchor: [5, 9], frames: [
    ['...MM.....', '...Mkk....', '..SPPPm...', '..SpPP..nh', '.nhhPhhhhh', 'n.hhhhhhh.', '..hhhhhh..', '..H.H.H.H.', '..H.H.H.H.'],
    ['...MM.....', '...Mkk....', '..SPPPmm..', '..SpPP..nh', '.nhhPhhhhh', 'n.hhhhhhh.', '..hhhhhh..', '.H..HH..H.', 'H...H....H'],
  ] },
  knights: { anchor: [5, 9], frames: [
    ['...MM......', '...MMM.....', '..SMMMwwwwm', '..SMMM..nm.', '.nPPMPPPmm.', 'n.PSPPPSP..', '..PPPPPP...', '..H.H.H.H..', '..H.H.H.H..'],
    ['...MM......', '...MMM.....', '..SMMMwwwwm', '..SMMM..nm.', '.nPPMPPPmm.', 'n.PSPPPSP..', '..PPPPPP...', '.H..HH..H..', 'H...H....H.'],
  ] },
  mages: { anchor: [2, 9], frames: [
    ['..p...', '..PP.f', '.PPPPw', 'PPPPPw', '.kkk.w', '.PPPkw', '.PSPPw', 'PPPPP.', '.b.b..'],
    ['..p..F', '..PPFf', '.PPPPw', 'PPPPPw', '.kkkkw', '.PPP.w', '.PSPPw', 'PPPPP.', '.b.b..'],
  ] },
  clerics: { anchor: [2, 9], frames: [
    ['..cc..', '.ckk..', '.cccg.', 'cPPc.g', '.cgc..', '.ccc..', '.cPc..', 'ccccc.', '.b.b..'],
    ['..cc.g', '.ckk.g', '.ccck.', 'cPPc..', '.cgc..', '.ccc..', '.cPc..', 'ccccc.', '.b.b..'],
  ] },
  catapult: { anchor: [6, 9], frames: [
    ['..........ss', '.........wss', '........w...', '.......w....', '.MM..Ww.....', '.kk.WWWWWWW.', 'PPP.wWwwwWw.', 'PPP.W.d..W..', 'b.b.dd...dd.'],
    ['............', '............', '.......wwwss', '......w...ss', '.MM..Ww.....', '.kk.WWWWWWW.', 'PPP.wWwwwWw.', 'PPP.W.d..W..', 'b.b.dd...dd.'],
  ] },
  beasts: { anchor: [4, 12], frames: [
    ['...TT.....', '..TttT....', '..tFtt....', '.PPttPP...', 'tttPPttt.w', 't.tttt.tww', 't.tttt..ww', '..tttt....', '..tPPt....', '..tttt....', '..t..t....', '.TT..TT...'],
    ['...TT...ww', '..TttT..ww', '..tFtt..w.', '.PPttPPt..', 'tttPPttt..', 't.tttt....', 't.tttt....', '..tttt....', '..tPPt....', '..tttt....', '.t....t...', 'TT....TT..'],
  ] },
  griffins: { anchor: [5, 9], frames: [
    ['...MM......', '...Pk...yy.', '...PP..yyyg', '.YYyyyyyyy.', 'YYYYyyyyy..', '.YYyyyyyY..', '...yy.yy...', '...y...y...', '...........'],
    ['YY.MM......', 'YYYPk...yy.', '.YYPP..yyyg', '..Yyyyyyyy.', '...yyyyyy..', '...yyyyyY..', '...yy.yy...', '...y...y...', '...........'],
  ] },
  archangels: { anchor: [5, 11], frames: [
    ['....ggg....', '...g...g...', 'AA..kkk..AA', 'aAA.kkk.AAa', 'aaAcPPPcAaa', '.aaAPSPAaa.', '..aAcPcAa..', '...ccccc...', '...ccccc...', '....c.c....', '...........'],
    ['a...ggg...a', 'aA.g...g.Aa', 'aAA.kkk.AAa', '.aAAkkkAAa.', '..AcPPPcA..', '...APSPA...', '...cPPPc...', '...ccccc...', '...ccccc...', '....c.c....', '...........'],
  ] },
  general: { anchor: [5, 11], frames: [
    ['...g.g.g...', '...ggggg...', '....kkk..m.', '..PPSSSk.m.', '.PPPSSS..m.', 'PPp.SSS..cn', '.PcccScccc.', 'n.cccccccC.', '..cccccccc.', '..C.C..C.C.', '..C.C..C.C.'],
    ['...g.g.g...', '...ggggg...', '....kkk....', '..PPSSSkmmm', '.PPPSSS....', 'PPp.SSS..cn', '.PcccScccc.', 'n.cccccccC.', '..cccccccc.', '.C..CC..C..', 'C...C....C.'],
  ] },
  dragon: { anchor: [12, 15], frames: [
    ['.......p..................', '......pQp.................', '.....pQQp.................', '....pQQQp.............ppp.', '...pQQQQp............pPPPp', '..pQQQQPp...........pPFPPm', '.pQQQQQPp..........pPPPSS.', 'pQQQQQPPp.........pPPp.m.m', '.ppppPPPPpppp....pPPp.....', 'p...pPPPPPPPPPPPPPPp......', 'Pp.pPPSSSSSSSSSSPPp.......', '.PPPPSSSSSSSSSSPPp........', '..pPPPPPPPPPPPPPp.........', '.....pPp..pPp.pPp.........', '.....mm...mm..mm..........', '..........................'],
    ['..........................', '..........................', '..........................', '......................ppp.', '.....................pPPPp', '..pppp..............pPFPPm', '.pQQQQpp...........pPPPSS.', 'pQQQQQQQpp........pPPp.m.m', '.pQQQQQPPPpppp...pPPp.....', 'p..ppPPPPPPPPPPPPPPp......', 'Pp.pPPSSSSSSSSSSPPp.......', '.PPPPSSSSSSSSSSPPp........', '..pPPPPPPPPPPPPPp.........', '.....pPp..pPp.pPp.........', '.....mm...mm..mm..........', '..........................'],
  ] },
  titan: { anchor: [7, 20], frames: [
    ['.....ssss.....', '....sFFFFs....', '....ssssss....', '.....eeee.....', '..sssPPPPsss..', '.ssssPSSPssss.', 'ssesssPPssssse', 'ss.sssssssss.s', 'ss.ssPPPPss..s', 'ee.ssssssss..e', 'ee..ssssss...e', 'ss..ssssss...s', '....ssssss....', '....sssssss...', '....ss...ss...', '....ss...ss...', '....ss...ss...', '....ss...ss...', '...eee...eee..', '...eee...eee..'],
    ['.....ssss.....', '....sFFFFs...s', '....ssssss..ss', '.....eeee..ss.', '..sssPPPPsss..', '.ssssPSSPsss..', 'ssesssPPssss..', 'ss.sssssssss..', 'ss.ssPPPPss...', 'ee.ssssssss...', 'ee..ssssss....', 'ss..ssssss....', '....ssssss....', '....sssssss...', '...ss....ss...', '...ss....ss...', '..ss.....ss...', '..ss.....ss...', '.eee.....eee..', '.eee.....eee..'],
  ] },
};

function hexToRgb(h) {
  let s = String(h || '#888888').replace('#', '');
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
export function shade(hex, k) { const [r, g, b] = hexToRgb(hex); return rgbToHex([r * k, g * k, b * k]); }
export function mix(a, b, k) { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex([A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k]); }
export function lighten(hex, k) { return mix(hex, '#ffffff', k); }
export function colorDist(a, b) { const A = hexToRgb(a), B = hexToRgb(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); }
export { hexToRgb };

/** Paint one sprite frame into a canvas; returns { c, w, h, ax, ay } (and the flipped copy). */
function paint(rows, pal, flip) {
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  for (let j = 0; j < h; j++) {
    const row = rows[j];
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '.' || ch === ' ') continue;
      const col = pal[ch] || BASE[ch];
      if (!col) continue;
      x.fillStyle = col;
      x.fillRect(flip ? w - 1 - i : i, j, 1, 1);
    }
  }
  return c;
}

/** Outline a canvas with a 1-px dark rim (improves readability on grass). */
function outlined(src, col) {
  const w = src.width + 2, h = src.height + 2;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  const tint = document.createElement('canvas');
  tint.width = src.width; tint.height = src.height;
  const tx = tint.getContext('2d');
  tx.drawImage(src, 0, 0);
  tx.globalCompositeOperation = 'source-in';
  tx.fillStyle = col;
  tx.fillRect(0, 0, tint.width, tint.height);
  for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) x.drawImage(tint, dx, dy);
  x.drawImage(src, 1, 1);
  return c;
}

/** Build every sprite for one army colour scheme: set[type][frame][flip] = { c, ax, ay } */
export function buildSpriteSet(primary, secondary) {
  const pal = { P: primary, p: shade(primary, 0.68), Q: lighten(primary, 0.35), S: secondary };
  const out = {};
  for (const [type, def] of Object.entries(SPRITES)) {
    out[type] = def.frames.map(rows => [false, true].map(flip => {
      const w = Math.max(...rows.map(r => r.length));
      const c = outlined(paint(rows, pal, flip), 'rgba(16,14,20,0.55)');
      const ax = (flip ? w - 1 - def.anchor[0] : def.anchor[0]) + 1;
      return { c, ax, ay: def.anchor[1] + 1 };
    }));
  }
  return out;
}

// 5x5 banner emblems (1 = secondary colour)
export const EMBLEM = {
  lion: ['.11..', '1111.', '.111.', '.1.1.', '.....'], eagle: ['1.1.1', '11111', '.111.', '..1..', '.....'],
  wolf: ['1...1', '11.11', '.111.', '..1..', '.....'], dragon: ['.11..', '1.11.', '..11.', '.11.1', '.....'],
  tower: ['1.1.1', '11111', '.111.', '.1.1.', '.....'], sun: ['1.1.1', '.111.', '11111', '.111.', '1.1.1'],
  moon: ['.11..', '1....', '1....', '.11..', '.....'], star: ['..1..', '11111', '.111.', '.1.1.', '.....'],
  skull: ['.111.', '1.1.1', '11111', '.1.1.', '.....'], crown: ['1.1.1', '11111', '11111', '.....', '.....'],
  sword: ['..1..', '..1..', '..1..', '.111.', '..1..'], tree: ['.111.', '11111', '.111.', '..1..', '..1..'],
  rose: ['.1.1.', '11111', '.111.', '..1..', '.....'], bear: ['1...1', '11111', '11111', '.111.', '.....'],
  serpent: ['.111.', '1....', '.111.', '....1', '.111.'], stag: ['1.1.1', '.1.1.', '..1..', '.111.', '..1..'],
  hammer: ['11111', '11111', '..1..', '..1..', '..1..'], flame: ['..1..', '.11..', '.111.', '11111', '.111.'],
  wave: ['.....', '.1..1', '1.11.', '.....', '.....'], raven: ['.11..', '1111.', '.1111', '...1.', '.....'],
};
