// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// tools/check-headers.mjs - verify that every source file starts with the two-line project header
// (the hackathon rules require the AI-generated statement in each file).
//
//   node tools/check-headers.mjs            list offenders, exit 1 if there are any
//   node tools/check-headers.mjs --fix      prepend the header to offenders (after a shebang)
//   node tools/check-headers.mjs --json     machine-readable result
//   node tools/check-headers.mjs web/src    check only the given directories or files
//
// Checked: .js, .mjs and .ts files under web/, proxy/, tools/ and test/ (node_modules, dist and
// dot-directories are skipped). A shebang line may come first; a UTF-8 BOM is tolerated.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const HEADER = [
  '// Tombaugh - SPHEREx blink comparator. Apache-2.0.',
  '// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.',
];
export const DEFAULT_DIRS = ['web', 'proxy', 'tools', 'test'];
const EXTENSIONS = new Set(['.js', '.mjs', '.ts']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'tmp']);

/** All checkable files under the given directories or files (absolute paths, sorted). */
export function listSourceFiles(targets, base = PROJECT) {
  const out = [];
  const walk = (p) => {
    let stat;
    try { stat = fs.statSync(p); } catch { return; }
    if (stat.isDirectory()) {
      const name = path.basename(p);
      if (SKIP_DIRS.has(name) || name.startsWith('.')) return;
      for (const ent of fs.readdirSync(p).sort()) walk(path.join(p, ent));
    } else if (stat.isFile() && EXTENSIONS.has(path.extname(p))) out.push(p);
  };
  for (const t of targets) {
    const p = path.resolve(base, t);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) { if (EXTENSIONS.has(path.extname(p))) out.push(p); } else walk(p);
  }
  return [...new Set(out)].sort();
}

/**
 * Check one file's text. Returns null when the header is in place, otherwise a short reason.
 */
export function headerProblem(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/, 4);
  const first = lines[0] !== undefined && lines[0].startsWith('#!') ? 1 : 0;
  if (lines[first] === HEADER[0] && lines[first + 1] === HEADER[1]) return null;
  if (lines[first] === HEADER[0]) return 'second header line is missing or differs';
  const anywhere = text.includes(HEADER[0]) && text.includes(HEADER[1]);
  if (anywhere) return 'header is present but not at the top of the file';
  if (/Tombaugh/.test(lines[first] || '') || /AI-generated/.test(lines[first + 1] || '')) return 'header text differs from the contract';
  return 'header is missing';
}

/** Text with the header put in place (after a shebang if there is one). */
export function withHeader(text) {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const body = bom ? text.slice(1) : text;
  const eol = /\r\n/.test(body) ? '\r\n' : '\n';
  const header = HEADER.join(eol) + eol;
  if (body.startsWith('#!')) {
    const nl = body.indexOf('\n');
    if (nl < 0) return bom + body + eol + header;
    return bom + body.slice(0, nl + 1) + header + body.slice(nl + 1);
  }
  return bom + header + body;
}

export function checkHeaders({ targets = DEFAULT_DIRS, fix = false, base = PROJECT } = {}) {
  const files = listSourceFiles(targets, base);
  const offenders = [];
  const fixed = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const problem = headerProblem(text);
    if (!problem) continue;
    const rel = path.relative(base, file).split(path.sep).join('/');
    if (fix) {
      fs.writeFileSync(file, withHeader(text));
      if (headerProblem(fs.readFileSync(file, 'utf8')) === null) { fixed.push({ file: rel, problem }); continue; }
    }
    offenders.push({ file: rel, problem });
  }
  return { checked: files.length, offenders, fixed };
}

function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const targets = argv.filter((a) => !a.startsWith('--'));
  for (const f of flags) {
    if (!['--fix', '--json', '--quiet', '--help'].includes(f)) { console.error(`unknown option ${f}`); return 2; }
  }
  if (flags.has('--help')) {
    console.log('Usage: node tools/check-headers.mjs [--fix] [--json] [--quiet] [dir-or-file ...]');
    return 0;
  }
  const r = checkHeaders({ targets: targets.length ? targets : DEFAULT_DIRS, fix: flags.has('--fix') });
  if (flags.has('--json')) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    for (const f of r.fixed) console.log(`fixed    ${f.file}  (${f.problem})`);
    for (const o of r.offenders) console.log(`MISSING  ${o.file}  (${o.problem})`);
    if (!flags.has('--quiet') || r.offenders.length) {
      console.log(`${r.checked} files checked, ${r.offenders.length} without the header${r.fixed.length ? `, ${r.fixed.length} fixed` : ''}.`);
      if (r.offenders.length && !flags.has('--fix')) console.log('Run with --fix to prepend the header.');
    }
  }
  return r.offenders.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
