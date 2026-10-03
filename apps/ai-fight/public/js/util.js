// Small DOM + formatting helpers, icons and game-data helpers shared by every screen.
// (renderer.js / sprites.js import clamp, lerp, rgba, hashStr and shade from here — keep them.)

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Hyperscript: h('div', {class: 'x', onclick}, 'text', child). Strings become text nodes (never HTML). */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v; // only ever used with trusted, static markup
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  appendAll(el, children);
  return el;
}

function appendAll(el, children) {
  for (const c of children) {
    if (c === undefined || c === null || c === false) continue;
    if (Array.isArray(c)) appendAll(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

/** Append children, skipping null/false and flattening arrays (unlike Element.append). */
export function add(el, ...children) { appendAll(el, children); return el; }

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtSecs(sec) {
  const s = Math.max(0, sec);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** m:ss for a duration in ms (rounded up, no leading zero on minutes). */
export function mss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** m:ss for a duration in ms (rounded), '—' when unknown. */
export const mmss = (ms) => (ms === null || ms === undefined ? '—' : `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}`);

export function ago(ts, now = Date.now()) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function clockTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function dateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function num(v, digits = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function pct(v) { return v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`; }

/** Short number: 12, 1.5, 0.35 (no trailing zeros). */
export function n2(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/** A fraction (0.25) or a percentage (25) shown as "25%". */
export function pctOf(v) {
  if (typeof v !== 'number') return String(v);
  return `${Math.round(Math.abs(v) <= 1 ? v * 100 : v)}%`;
}

export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

// ── color helpers (OKLCH) ─────────────────────────────────────────────────────
function srgbToLinear(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function linearToSrgb(c) { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(clamp(v, 0, 1) * 255); }

export function hexToOklch(hex) {
  const n = parseInt(hex.slice(1).length === 3 ? hex.slice(1).split('').map(x => x + x).join('') : hex.slice(1), 16);
  const r = srgbToLinear((n >> 16) & 255), g = srgbToLinear((n >> 8) & 255), b = srgbToLinear(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), H: Math.atan2(B, A) };
}

export function oklchToHex({ L, C, H }) {
  const A = C * Math.cos(H), B = C * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return '#' + [r, g, b].map(linearToSrgb).map(v => v.toString(16).padStart(2, '0')).join('');
}

// Chart marks need colours inside the dark-surface lightness band. The two
// default fighter colours map to validated palette steps (orange #d95926 /
// aqua #199e70: CVD ΔE 9.4, normal ΔE 26.5 on this surface); custom colours
// are clamped into the band and always ship with direct labels + a legend.
const VALIDATED = { '#e8825c': '#d95926', '#2fc58e': '#199e70' };
export function chartColor(hex) {
  const key = String(hex || '').toLowerCase();
  if (VALIDATED[key]) return VALIDATED[key];
  try {
    const o = hexToOklch(key);
    return oklchToHex({ L: clamp(o.L, 0.5, 0.64), C: Math.max(o.C, 0.11), H: o.H });
  } catch { return key; }
}

export function rgba(hex, a) {
  const h2 = hex.replace('#', '');
  const full = h2.length === 3 ? h2.split('').map(x => x + x).join('') : h2;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function shade(hex, amount) {
  // amount < 0 darkens, > 0 lightens (in OKLCH lightness)
  try {
    const o = hexToOklch(hex);
    return oklchToHex({ L: clamp(o.L + amount, 0, 1), C: o.C, H: o.H });
  } catch { return hex; }
}

// ── icons (static trusted SVG markup, 24×24, drawn with currentColor) ────────
const ICONS = {
  // ability types
  melee: '<path d="M19.5 3.5 L10 13" stroke="currentColor" stroke-width="3" stroke-linecap="square"/><path d="M6.5 11 L13 17.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"/><path d="M9.2 14.8 L4.5 19.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"/>',
  projectile: '<circle cx="16" cy="8" r="4" fill="currentColor"/><path d="M3 21 L12 12 M6 21 l-3 0 l0 -3" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".7"/>',
  area: '<circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="7.5" stroke="currentColor" stroke-width="2" fill="none" opacity=".75"/><path d="M12 1.5 v2.5 M12 20 v2.5 M1.5 12 h2.5 M20 12 h2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  zone: '<ellipse cx="12" cy="15" rx="9" ry="5" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity=".25"/><path d="M8 13 q1 -5 4 -8 q3 3 4 8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  dash: '<path d="M4 6 l6 6 l-6 6 M11 6 l6 6 l-6 6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 5 v14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".6"/>',
  shield: '<path d="M12 2.5 L20 5.5 V11.5 C20 16.5 16.5 20 12 21.5 C7.5 20 4 16.5 4 11.5 V5.5 Z" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity=".22" stroke-linejoin="round"/>',
  heal: '<path d="M12 21 C5 16 2.5 12.5 2.5 8.8 C2.5 6 4.6 3.8 7.3 3.8 C9.3 3.8 11 5 12 6.7 C13 5 14.7 3.8 16.7 3.8 C19.4 3.8 21.5 6 21.5 8.8 C21.5 12.5 19 16 12 21Z" fill="currentColor" fill-opacity=".25" stroke="currentColor" stroke-width="2"/><path d="M12 9.5 v6 M9 12.5 h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  buff: '<path d="M12 3 L19 10 H15 V20 H9 V10 H5 Z" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity=".22" stroke-linejoin="round"/>',
  beam: '<circle cx="5" cy="12" r="3.2" fill="currentColor"/><path d="M8.5 12 H22" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><path d="M9.5 7.5 H19 M9.5 16.5 H19" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>',
  trap: '<path d="M3 19 H21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M4.5 17 L7 9 L9.5 17 L12 9 L14.5 17 L17 9 L19.5 17" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity=".22" stroke-linejoin="round"/>',
  counter: '<path d="M12 2.5 L19.5 5.5 V11 C19.5 15.8 16.4 19 12 20.8 C7.6 19 4.5 15.8 4.5 11 V5.5 Z" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity=".16" stroke-linejoin="round"/><path d="M15.5 11.5 H8.5 M11.5 8.5 L8.5 11.5 L11.5 14.5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  cleanse: '<path d="M12 2.8 C12 2.8 5.5 10 5.5 14.4 C5.5 18 8.4 21 12 21 C15.6 21 18.5 18 18.5 14.4 C18.5 10 12 2.8 12 2.8 Z" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity=".22" stroke-linejoin="round"/><path d="M9 14.5 C9 16.4 10.3 17.8 12 17.8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  turret: '<path d="M6 21 L10 14 M18 21 L14 14 M12 14 V21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="6.5" y="8" width="11" height="6.5" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity=".25"/><path d="M17.5 11.2 H22.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"/><circle cx="10" cy="11.2" r="1.3" fill="currentColor"/>',
  ultimate: '<path d="M12 1.8 L14.6 8.6 L21.8 9 L16.2 13.6 L18.1 20.6 L12 16.6 L5.9 20.6 L7.8 13.6 L2.2 9 L9.4 8.6 Z" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity=".3" stroke-linejoin="round"/>',
  // weapon families (the free basic attack)
  w_slash: '<path d="M20 4 L9 15" stroke="currentColor" stroke-width="3.2" stroke-linecap="square"/><path d="M20 4 L16.5 4.6 M20 4 L19.4 7.5" stroke="currentColor" stroke-width="1.6"/><path d="M5.8 12.2 L11.8 18.2" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"/><path d="M8.3 15.7 L4 20" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"/>',
  w_thrust: '<path d="M3.5 20.5 L16 8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M21 3 L14.2 5.6 L18.4 9.8 Z" fill="currentColor"/><path d="M12.5 13.5 l-2 -2" stroke="currentColor" stroke-width="2" opacity=".6"/>',
  w_smash: '<path d="M12.5 11.5 L4 20" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M12 5 L16.5 0.5 L23.5 7.5 L19 12 Z" transform="translate(-1.5 1.5)" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity=".35" stroke-linejoin="round"/>',
  w_claw: '<path d="M6 3.5 Q10.5 11 6 20.5 M11.5 3.5 Q16 11 11.5 20.5 M17 3.5 Q21.5 11 17 20.5" stroke="currentColor" stroke-width="2.3" fill="none" stroke-linecap="round"/>',
  w_fists: '<path d="M5 10.5 Q5 8 7.5 8 H16 Q19 8 19 11 V15.5 Q19 19.5 15 19.5 H9 Q5 19.5 5 15.5 Z" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity=".22" stroke-linejoin="round"/><path d="M8.5 8 V5.5 M11.8 8 V4.5 M15.1 8 V5.5 M5 12.5 H9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  w_shoot: '<path d="M7 2.5 Q20.5 12 7 21.5" stroke="currentColor" stroke-width="2.3" fill="none" stroke-linecap="round"/><path d="M7 2.5 V21.5" stroke="currentColor" stroke-width="1.2" opacity=".6"/><path d="M3 12 H19 M16 9 L19.5 12 L16 15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  w_gun: '<path d="M2.5 7.5 H20.5 V12 H11.5 L9.5 19 H5.2 L6.8 12 H2.5 Z" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity=".25" stroke-linejoin="round"/><path d="M20.5 9.7 H23" stroke="currentColor" stroke-width="2"/>',
  w_cast: '<path d="M5 21.5 L14.5 9.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="17" cy="6.5" r="3.6" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity=".35"/><path d="M17 0.8 v1.6 M22.7 6.5 h-1.6 M21 2.5 l-1.1 1.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  w_shield: '<path d="M10 6 L17 8.5 V13 C17 17 14.2 19.8 10 21.5 C5.8 19.8 3 17 3 13 V8.5 Z" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity=".25" stroke-linejoin="round"/><path d="M21.5 2.5 L13.5 10.5 M12 7.5 L16.5 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
};
function svgIcon(markup) {
  const span = document.createElement('span');
  span.style.display = 'contents';
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${markup}</svg>`;
  return span.firstChild;
}
export function abilityIcon(type) { return svgIcon(ICONS[type] || ICONS.melee); }

const WEAPON_ICON_BY_ID = { fists: 'w_fists', shield: 'w_shield' };
const WEAPON_KIND_FALLBACK = { melee: 'w_slash', projectile: 'w_shoot' };
/** Icon for a weapon (by id / animation family), or for a basic-attack ability. */
export function weaponIcon(weapon, ab) {
  const id = (weapon && weapon.id) || (ab && ab.weapon) || '';
  const kind = (weapon && weapon.kind) || '';
  const key = WEAPON_ICON_BY_ID[id] || (ICONS[`w_${kind}`] ? `w_${kind}` : null) || (ab && WEAPON_KIND_FALLBACK[ab.type]) || 'w_slash';
  return svgIcon(ICONS[key]);
}

/** The icon for any ability: weapon attacks get their weapon's icon. */
export function iconFor(ab, spec) {
  if (ab && ab.basic && ab.offhand) return weaponIcon(spec && spec.offhand && typeof spec.offhand === 'object' ? spec.offhand : null, ab);
  if (ab && ab.basic) return weaponIcon(spec && spec.weapon, ab);
  return abilityIcon(ab && ab.type);
}

// ── game data (v2 + v3, with graceful fallbacks) ─────────────────────────────
const STAT_FALLBACK = ['vitality', 'power', 'armor', 'speed', 'energy', 'regen'];
const STAT_META = {
  vitality: { label: 'Vitality', short: 'VIT', group: 'defence', formula: 'max HP = 900 + 25 × vitality' },
  power: { label: 'Power', short: 'POW', group: 'offence', formula: 'damage dealt × (1 + 0.025 × power)' },
  armor: { label: 'Armor', short: 'ARM', group: 'defence', formula: 'damage taken × 100 / (100 + 2.5 × armor)' },
  speed: { label: 'Speed', short: 'SPD', group: 'utility', formula: 'move speed = 170 + 4.5 × speed (units/s)' },
  energy: { label: 'Energy', short: 'ENG', group: 'utility', formula: 'max energy = 100 + 4 × energy' },
  regen: { label: 'Regen', short: 'REG', group: 'utility', formula: 'energy regen per second' },
  crit: { label: 'Crit', short: 'CRT', group: 'offence', formula: 'chance that a hit deals double damage' },
  haste: { label: 'Haste', short: 'HST', group: 'utility', formula: 'shorter cooldowns and windups' },
  tenacity: { label: 'Tenacity', short: 'TEN', group: 'defence', formula: 'shorter stuns, roots, silences, slows; less damage over time' },
  precision: { label: 'Precision', short: 'PRC', group: 'offence', formula: 'ignore part of the target’s armor; faster projectiles' },
  vigor: { label: 'Vigor', short: 'VIG', group: 'defence', formula: 'regenerates HP every second; more healing received' },
  focus: { label: 'Focus', short: 'FOC', group: 'utility', formula: 'ultimate and divinity charge faster; longer awakening' },
};

/** Stat keys in display order (bootstrap rules.statKeys, else the 6 classic stats). */
export function statKeys(rules, stats) {
  if (rules && Array.isArray(rules.statKeys) && rules.statKeys.length) return rules.statKeys;
  if (stats) {
    const extra = Object.keys(stats).filter(k => !STAT_FALLBACK.includes(k) && typeof stats[k] === 'number');
    return STAT_FALLBACK.concat(extra);
  }
  return STAT_FALLBACK;
}

/** {label, short, group, formula} for a stat. */
export function statMeta(rules, k) {
  const fromRules = rules && rules.statInfo && rules.statInfo[k];
  const base = STAT_META[k] || { label: cap(k), short: k.slice(0, 3).toUpperCase(), group: 'utility', formula: '' };
  return Object.assign({}, base, fromRules || {});
}

/** What a stat does for this fighter, from spec.derived ('' when unknown). */
export function derivedText(k, d) {
  if (!d) return '';
  const p = (v) => `${Math.round(v * 100)}%`;
  switch (k) {
    case 'vitality': return d.maxHp !== undefined ? `${num(d.maxHp)} HP` : '';
    case 'power': return d.damageMult !== undefined ? `×${Number(d.damageMult).toFixed(2)} dmg` : '';
    case 'armor': return d.damageTaken !== undefined ? `takes ${p(d.damageTaken)}` : '';
    case 'speed': return d.moveSpeed !== undefined ? `${Math.round(d.moveSpeed)} spd` : '';
    case 'energy': return d.maxEnergy !== undefined ? `${Math.round(d.maxEnergy)} max` : '';
    case 'regen': return d.energyRegen !== undefined ? `${n2(d.energyRegen)}/s` : '';
    case 'crit': return d.critChance ? `${p(d.critChance)} crit` : '';
    case 'haste': return d.cooldownMult !== undefined && d.cooldownMult < 1 ? `cd −${p(1 - d.cooldownMult)}` : '';
    case 'tenacity': return d.ccMult !== undefined && d.ccMult < 1 ? `CC −${p(1 - d.ccMult)}` : '';
    case 'precision': return d.armorPen ? `pierce ${p(d.armorPen)}` : '';
    case 'vigor': return d.hpRegen ? `+${n2(d.hpRegen)} HP/s` : d.healMult > 1 ? `heal ×${n2(d.healMult)}` : '';
    case 'focus': return d.chargeMult > 1 ? `charge ×${n2(d.chargeMult)}` : d.awakenSeconds ? `awaken ${n2(d.awakenSeconds)}s` : '';
    default: return '';
  }
}

// Every derived number with a readable label (unknown keys are humanized).
const DERIVED_LABEL = {
  maxHp: ['Max HP', (v) => num(v)],
  damageMult: ['Damage dealt', (v) => `×${Number(v).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`],
  armor: ['Armor', (v) => num(v)],
  takenMult: ['Damage taken (traits)', (v) => `×${n2(v)}`],
  damageTaken: ['Damage taken', (v) => pct(v)],
  moveSpeed: ['Move speed', (v) => `${n2(v)} u/s`],
  maxEnergy: ['Max energy', (v) => num(v)],
  energyRegen: ['Energy regen', (v) => `${n2(v)} /s`],
  critChance: ['Crit chance', (v) => pct(v)],
  critMult: ['Crit damage', (v) => `×${n2(v)}`],
  cooldownMult: ['Cooldowns', (v) => `×${n2(v)}`],
  windupMult: ['Windups', (v) => `×${n2(v)}`],
  ccMult: ['Crowd-control on you', (v) => `×${n2(v)}`],
  dotMult: ['Damage over time on you', (v) => `×${n2(v)}`],
  armorPen: ['Armor ignored', (v) => pct(v)],
  projSpeedMult: ['Projectile speed', (v) => `×${n2(v)}`],
  hpRegen: ['HP regen', (v) => `${n2(v)} /s`],
  healMult: ['Healing received', (v) => `×${n2(v)}`],
  chargeMult: ['Ultimate / divinity charge', (v) => `×${n2(v)}`],
  awakenSeconds: ['Awakening lasts', (v) => `${n2(v)} s`],
};
export function derivedRows(d) {
  if (!d) return [];
  return Object.entries(d).filter(([, v]) => typeof v === 'number').map(([k, v]) => {
    const m = DERIVED_LABEL[k];
    return m ? [m[0], m[1](v), k] : [cap(k.replace(/([A-Z])/g, ' $1').toLowerCase()), n2(v), k];
  });
}

/** The weapon a fighter carries: spec.weapon (v3), else built from the basic attack, else null (v2). */
export function weaponOf(spec, rules) {
  if (!spec) return null;
  const basic = basicAttack(spec);
  if (!spec.weapon && !basic) return null;
  const w = Object.assign({}, typeof spec.weapon === 'string' ? { id: spec.weapon } : (spec.weapon || {}));
  if (!w.id && basic && basic.weapon) w.id = basic.weapon;
  const cat = weaponCatalog(rules)[w.id];
  if (cat) { for (const k of ['name', 'kind', 'passiveText']) if (w[k] === undefined && cat[k] !== undefined) w[k] = cat[k]; }
  if (!w.name) w.name = w.id ? cap(w.id) : (basic ? basic.name : 'Weapon');
  if (!w.attackName) w.attackName = (w.attack && w.attack.name) || (basic && basic.name) || '';
  return w;
}

/** rules.weapons as {id: weapon} (accepts an object or an array). */
export function weaponCatalog(rules) {
  const w = rules && rules.weapons;
  if (!w) return {};
  if (Array.isArray(w)) return Object.fromEntries(w.filter(x => x && x.id).map(x => [x.id, x]));
  return w;
}

export function basicAttack(spec) {
  const list = (spec && spec.abilities) || [];
  return list.find(a => a && a.basic && !a.offhand) || list.find(a => a && a.basic) || null;
}
/** The fighter's own abilities: no weapon attacks, no ultimate. */
export function realAbilities(spec) { return ((spec && spec.abilities) || []).filter(a => a && !a.basic && !a.ultimate && !a.offhand); }

// ── v4: ultimate, off-hand weapon, relics, godly powers (absent in v2/v3 data) ──
export function ultimateOf(spec) {
  if (!spec) return null;
  if (spec.ultimate && typeof spec.ultimate === 'object') return spec.ultimate;
  return ((spec.abilities) || []).find(a => a && a.ultimate) || null;
}
export function offhandOf(spec, rules) {
  if (!spec || !spec.offhand) return null;
  const w = Object.assign({}, typeof spec.offhand === 'string' ? { id: spec.offhand } : spec.offhand);
  const cat = weaponCatalog(rules)[w.id];
  if (cat) { for (const k of ['name', 'kind', 'passiveText']) if (w[k] === undefined && cat[k] !== undefined) w[k] = cat[k]; }
  if (!w.name) w.name = cap(String(w.id || 'off-hand'));
  const list = (spec.abilities) || [];
  w.basic = list.find(a => a && a.basic && a.offhand) || null;
  return w;
}
const titleCase = (s) => String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
function catalogItem(list, key, catalog) {
  return (list || []).map(x => {
    const o = typeof x === 'string' ? { id: x } : Object.assign({}, x);
    const c = catalog && catalog[o.id];
    if (c) for (const k of Object.keys(c)) if (o[k] === undefined) o[k] = c[k];
    if (!o.name) o.name = titleCase(o.id);
    return o;
  });
}
export function relicsOf(spec, rules) { return catalogItem(spec && spec.relics, 'relics', rules && rules.relics); }
export function godPowersOf(spec, rules) { return catalogItem(spec && spec.godPowers, 'godPowers', rules && (rules.godPowers || rules.powers)); }

// Names of the weapons' free attacks (rules.weapons when the server sends it; the v3 catalog otherwise).
const WEAPON_ATTACKS = ['Punch', 'Slash', 'Cleave', 'Stab', 'Thrust', 'Smash', 'Hack', 'Reap', 'Lash', 'Draw Cut', 'Jab', 'Rake', 'Arrow', 'Bolt Shot', 'Orb', 'Spark', 'Shot'];
export function weaponAttackNames(rules) {
  const cat = weaponCatalog(rules);
  const names = Object.values(cat).map(w => (w && w.attack && w.attack.name) || (w && w.attackName)).filter(Boolean);
  return new Set((names.length ? names : WEAPON_ATTACKS).map(n => n.toLowerCase()));
}
/** Abilities of an archived version without its weapon attack (old records don't flag it: it is the last one). */
export function archivedAbilities(v, rules) {
  const list = ((v && v.abilities) || []).slice();
  if (list.some(a => a.basic)) return list.filter(a => !a.basic);
  const v3 = !!(v && (v.weapon || (v.stats && v.stats.crit !== undefined)));
  const last = list[list.length - 1];
  if (v3 && last && weaponAttackNames(rules).has(String(last.name).toLowerCase())) list.pop();
  return list;
}

// ── abilities: effects + numbers ────────────────────────────────────────────
/** [class, short text, long text] for each on-hit effect / notable modifier. */
export function effectChips(ab) {
  const out = [];
  const fx = (ab && ab.effects) || {};
  const s = (v) => `${n2(v)}s`;
  if (fx.stun) out.push(['stun', `stun ${s(fx.stun)}`, `Stuns for ${s(fx.stun)}`]);
  if (fx.root) out.push(['root', `root ${s(fx.root)}`, `Roots (can't move) for ${s(fx.root)}`]);
  if (fx.silence) out.push(['silence', `silence ${s(fx.silence)}`, `Silences (no abilities) for ${s(fx.silence)}`]);
  if (fx.slow) out.push(['slow', `slow ${pctOf(fx.slow.amount)} ${s(fx.slow.duration)}`, `Slows by ${pctOf(fx.slow.amount)} for ${s(fx.slow.duration)}`]);
  if (fx.knockback > 0) out.push(['knockback', `knock ${n2(fx.knockback)}`, `Knocks back ${n2(fx.knockback)} units`]);
  if (fx.knockback < 0) out.push(['pull', `pull ${n2(-fx.knockback)}`, `Pulls ${n2(-fx.knockback)} units toward the caster`]);
  if (fx.burn) out.push(['burn', `burn ${n2(fx.burn.dps)}/s ${s(fx.burn.duration)}`, `Burns for ${n2(fx.burn.dps)} damage/s over ${s(fx.burn.duration)}`]);
  if (fx.poison) out.push(['poison', `poison ${n2(fx.poison.dps)}/s ${s(fx.poison.duration)}`, `Poisons for ${n2(fx.poison.dps)} damage/s over ${s(fx.poison.duration)} and halves healing`]);
  if (fx.vulnerable) out.push(['vuln', `vulnerable +${pctOf(fx.vulnerable.amount)} ${s(fx.vulnerable.duration)}`, `Target takes +${pctOf(fx.vulnerable.amount)} damage for ${s(fx.vulnerable.duration)}`]);
  if (fx.weaken) out.push(['weak', `weaken −${pctOf(fx.weaken.amount)} ${s(fx.weaken.duration)}`, `Target deals −${pctOf(fx.weaken.amount)} damage for ${s(fx.weaken.duration)}`]);
  if (fx.drain) out.push(['drain', `drain ${n2(fx.drain)} en`, `Drains ${n2(fx.drain)} energy (the caster gains half)`]);
  if (fx.lifesteal) out.push(['lifesteal', `lifesteal ${pctOf(fx.lifesteal)}`, `Heals ${pctOf(fx.lifesteal)} of the damage dealt`]);
  if (!ab) return out;
  if (ab.type === 'zone' && ab.slow) out.push(['slow', `slow ${pctOf(ab.slow)}`, `Slows by ${pctOf(ab.slow)} inside the zone`]);
  if (ab.type === 'zone' && ab.pull) out.push(['pull', `pull ${n2(ab.pull)}/s`, `Drags the enemy toward the centre at ${n2(ab.pull)} units/s`]);
  if (ab.type === 'zone' && ab.follow) out.push(['info', 'follows you', 'The zone moves with the caster']);
  if (ab.type === 'dash' && ab.invulnerable) out.push(['inv', 'i-frames', 'Cannot be hit while dashing']);
  if (ab.type === 'dash' && ab.teleport) out.push(['inv', 'teleport', 'Blinks instantly']);
  if (ab.type === 'cleanse' && ab.immunity) out.push(['inv', `immune ${s(ab.immunity)}`, `Immune to crowd control for ${s(ab.immunity)} afterwards`]);
  if (ab.type === 'projectile' && ab.returns) out.push(['info', 'returns', 'Boomerang: can hit again on the way back']);
  if (ab.type === 'projectile' && ab.bounce) out.push(['info', `bounce ×${ab.bounce}`, `Ricochets off obstacles ${ab.bounce}×`]);
  if (ab.type === 'projectile' && ab.homing) out.push(['info', `homing ${pctOf(ab.homing)}`, 'Curves toward the target']);
  return out;
}

/** The 2–4 numbers that matter most for an ability (compact rows). */
export function abilityNumbers(ab) {
  const n = [];
  const s = (v) => `${n2(v)}s`;
  const dmg = (d, times) => `${n2(d)}${times > 1 ? `×${times}` : ''} dmg`;
  switch (ab.type) {
    case 'melee': n.push(dmg(ab.damage, ab.hits), `rng ${n2(ab.range)}`, `${n2(ab.arc)}°`); if (ab.lunge) n.push(`lunge ${n2(ab.lunge)}`); break;
    case 'projectile': n.push(dmg(ab.damage, ab.count), `spd ${n2(ab.speed)}`, `rng ${n2(ab.range)}`); break;
    case 'area':
      n.push(`${n2(ab.damage)} dmg`, `r ${n2(ab.radius)}`);
      if (ab.target === 'point') n.push(`at ${n2(ab.range)}${ab.delay ? ` +${s(ab.delay)}` : ''}`);
      break;
    case 'zone': n.push(`${n2(ab.dps)}/s ×${s(ab.duration)}`, `r ${n2(ab.radius)}`); if (!ab.follow && ab.range) n.push(`rng ${n2(ab.range)}`); break;
    case 'dash': n.push(`${n2(ab.distance)} dist`); if (ab.damage) n.push(`${n2(ab.damage)} dmg`); break;
    case 'shield': n.push(`${n2(ab.amount)} for ${s(ab.duration)}`); break;
    case 'heal': n.push(ab.duration ? `${n2(ab.amount)} over ${s(ab.duration)}` : `+${n2(ab.amount)} hp`); break;
    case 'buff': n.push(`+${n2(ab.amount)}% ${ab.stat}`, s(ab.duration)); break;
    case 'beam': n.push(`${n2(ab.dps)}/s ×${s(ab.duration)}`, `rng ${n2(ab.range)}`, `w ${n2(ab.width)}`); break;
    case 'trap': n.push(`${n2(ab.damage || 0)} dmg`, `r ${n2(ab.radius)}`, `arms ${s(ab.arm)}`); break;
    case 'counter': n.push(`${s(ab.duration)} parry`); if (ab.damage) n.push(`${n2(ab.damage)} dmg`); n.push(`rng ${n2(ab.range)}`); break;
    case 'cleanse': n.push(ab.immunity ? `${s(ab.immunity)} immune` : 'removes CC'); break;
    case 'turret':
      if (ab.damage !== undefined) n.push(`${n2(ab.damage)} dmg`);
      if (ab.rate) n.push(`${n2(ab.rate)}/s`);
      if (ab.duration) n.push(s(ab.duration));
      if (ab.range) n.push(`rng ${n2(ab.range)}`);
      break;
    default: {
      for (const [k, v] of abilityFields(ab).slice(0, 3)) n.push(`${k} ${v}`);
    }
  }
  return n;
}

// Every design number of an ability, for the detailed views.
const META_FIELDS = new Set(['name', 'type', 'color', 'style', 'description', 'index', 'cost', 'design', 'traitNotes', 'reach', 'effects', 'basic', 'weapon', 'energy', 'cooldown', 'windup']);
const FIELD_LABEL = {
  rate: 'Shots / s',
  damage: 'Damage', range: 'Range', arc: 'Arc', speed: 'Speed', radius: 'Radius', count: 'Projectiles', spread: 'Spread', homing: 'Homing',
  dps: 'Damage / s', duration: 'Duration', slow: 'Slow', distance: 'Distance', invulnerable: 'Invulnerable', amount: 'Amount', stat: 'Stat',
  hits: 'Hits per swing', lunge: 'Lunge', delay: 'Delay', target: 'Target', bounce: 'Bounces', returns: 'Returns', pull: 'Pull', follow: 'Follows caster',
  teleport: 'Teleport', width: 'Width', turnRate: 'Turn rate', arm: 'Arms after', immunity: 'Immunity',
};
const FIELD_UNIT = { duration: 's', delay: 's', arm: 's', immunity: 's', arc: '°', spread: '°', turnRate: '°/s', dps: '/s', pull: '/s' };
export function abilityFields(ab) {
  const rows = [];
  for (const [k, v] of Object.entries(ab || {})) {
    if (META_FIELDS.has(k) || v === undefined || v === null || typeof v === 'object') continue;
    if (typeof v === 'boolean' && !v) continue;
    if (typeof v === 'number' && v === 0) continue;
    let text;
    if (typeof v === 'boolean') text = 'yes';
    else if (typeof v === 'number') {
      if (k === 'slow' || k === 'homing') text = pctOf(v);
      else text = `${n2(v)}${FIELD_UNIT[k] || ''}`;
    } else text = String(v);
    rows.push([FIELD_LABEL[k] || cap(k.replace(/([A-Z])/g, ' $1').toLowerCase()), text, k]);
  }
  return rows;
}

// ── replay flags (renderer frames + hit events; v2 bits + v3 bits) ──────────
export const FL = {
  STUN: 1, SLOW: 2, BURN: 4, INVULN: 8, DASH: 16, POWER: 32, ARMOR: 64, SPEED: 128, REGEN: 256, SHIELD: 512, KO: 1024, HOT: 2048, KNOCK: 4096, CAST: 8192,
  ROOT: 16384, SILENCE: 32768, VULN: 65536, WEAK: 131072, POISON: 262144, IMMUNE: 524288, COUNTER: 1048576, CHANNEL: 2097152, HASTE: 4194304, CRITBUFF: 8388608, TENACITY: 16777216,
};
export const HIT = { STUN: 1, RESISTED: 2, SLOW: 4, BURN: 8, KNOCK: 16, LIFESTEAL: 32, CRIT: 64, ROOT: 128, SILENCE: 256, VULN: 512, WEAK: 1024, POISON: 2048, DRAIN: 4096, BLOCK: 8192, BASIC: 16384 };
// Wall clock → sim time (SPEC v4 §3, used verbatim everywhere): during a cinematic the sim
// holds still for `ms` of wall-clock time while effects keep animating. v2/v3 replays have none.
// elapsedMs since the fight started (live) or since replay position 0 (replays)
// The host can switch hit-stops off (Settings); then replays play straight through.
let HOLDS = true;
export function setHolds(on) { HOLDS = on !== false; }
export function simAt(replay, elapsedMs) {
  if (!HOLDS) return { t: elapsedMs / 1000, hold: null };
  let e = elapsedMs;
  for (let i = 0; i < (replay.cinematics || []).length; i++) {
    const c = replay.cinematics[i], ct = (c.t / replay.tickRate) * 1000;
    if (e < ct) break;
    if (e < ct + c.ms) return { t: c.t / replay.tickRate, hold: { index: i, kind: c.kind, a: c.a, v: c.v, elapsedMs: e - ct, totalMs: c.ms } };
    e -= c.ms;
  }
  return { t: e / 1000, hold: null };
}
/** Seconds a replay takes to watch: sim duration + every cinematic hold. */
export function watchSeconds(replay, simDuration) {
  if (!HOLDS) return simDuration;
  return simDuration + ((replay && replay.cinematics) || []).reduce((a, c) => a + (c.ms || 0), 0) / 1000;
}

// v4 fighter flags2 (frame index 12)
export const F2 = { AWAKENED: 1, ASCENDED: 2, ULT_READY: 4, GOD_READY: 8, SWAPPING: 16, REVIVED: 32, MARKED: 64, WARD: 128, ULT_CAST: 256,
  TIMESTOPPED: 1 << 12, AVATAR: 1 << 13, PHOENIX: 1 << 14, GOD_CAST: 1 << 15 };   // the last four come from engine/powers.js
export const STANCES = ['balanced', 'aggressive', 'defensive', 'swift'];
export const STANCE_INFO = {
  balanced: { icon: '⚖', text: 'Balanced: no modifiers' },
  aggressive: { icon: '⚔', text: 'Aggressive: deals ×1.15, takes ×1.12' },
  defensive: { icon: '🛡', text: 'Defensive: takes ×0.82, deals ×0.88, speed ×0.9' },
  swift: { icon: '💨', text: 'Swift: speed ×1.15, deals ×0.92' },
};

// ── toasts ───────────────────────────────────────────────────────────────────
/** A short message in the corner. `action` = {label, onClick} adds a button. */
export function toast(text, level = 'info', ms = 4200, action = null) {
  const box = document.getElementById('toasts');
  if (!box) return null;
  const el = h('div', { class: `toast ${level}`, role: 'status' }, h('span', null, text));
  if (action) el.append(h('button', { class: 'btn small', onclick: () => { action.onClick(); el.remove(); } }, action.label));
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 450); }, ms);
  return el;
}

// ── tiny persisted preferences (per browser) ────────────────────────────────
export function pref(key, def) { try { const v = localStorage.getItem(key); return v === null ? def : v === '1'; } catch { return def; } }
export function setPref(key, on) { try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* ignore */ } }
export function prefStr(key, def) { try { const v = localStorage.getItem(key); return v === null ? def : v; } catch { return def; } }
export function setPrefStr(key, v) { try { localStorage.setItem(key, String(v)); } catch { /* ignore */ } }
