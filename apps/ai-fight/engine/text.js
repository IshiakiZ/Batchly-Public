'use strict';
// Console output must survive any terminal / code page (PowerShell 5, Git Bash,
// agent sandboxes), so everything the CLI prints is folded to plain ASCII.

const MAP = [
  [/[═━]/g, '='], [/[─]/g, '-'], [/[·•]/g, '|'], [/[—–]/g, '-'], [/→/g, '->'], [/←/g, '<-'],
  [/×/g, 'x'], [/°/g, 'deg'], [/…/g, '...'], [/≤/g, '<='], [/≥/g, '>='], [/[✓✔]/g, 'OK'],
  [/[✗✘]/g, 'X'], [/[“”]/g, '"'], [/[‘’]/g, "'"], [/⚡/g, 'E'], [/≈/g, '~'], [/[−‑]/g, '-'], [/±/g, '+/-'],
];

function ascii(text) {
  let s = String(text);
  for (const [re, rep] of MAP) s = s.replace(re, rep);
  // Anything else outside printable ASCII (emoji etc.) becomes '?'.
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '?');
}

module.exports = { ascii };
