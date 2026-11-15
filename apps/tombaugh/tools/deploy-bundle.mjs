// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// tools/deploy-bundle.mjs - assemble and verify the upload set of the Supabase edge function
// "spherex".
//
//   node tools/deploy-bundle.mjs             verify, write dist/edge/files.json and dist/edge/spherex/
//   node tools/deploy-bundle.mjs --print     verify, print the JSON to stdout instead of writing
//   node tools/deploy-bundle.mjs --list      verify, print only the file table
//   node tools/deploy-bundle.mjs --strict    treat warnings (lazy imports that leave the set,
//                                            Node globals) as errors
//   options: --out <dir> (default dist/edge), --function <name> (default spherex)
//
// The set is proxy/supabase/functions/<name>/index.ts plus every proxy/src/*.js that is not a
// test, uploaded as [{ name: "index.ts" | "src/<file>.js", content }]: in the deployed function
// the src/ folder sits next to index.ts. Checks:
//   * index.ts imports only from "./src/..." and every such file is in the set;
//   * no module of the set imports a Node built-in, a bare package or a URL;
//   * every relative import resolves to a file of the set (nothing from proxy/fixtures etc.);
//   * computed dynamic imports and Node-only globals are reported as warnings.
// Exit codes: 0 ready to deploy, 1 verification failed, 2 the function does not exist yet.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { builtinModules } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { tokenize, analyzeModule, lineCol, BuildError } from './build.mjs';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILTINS = new Set(builtinModules.filter((m) => !m.startsWith('_')));
const NODE_GLOBALS = new Set(['process', 'Buffer', 'require', '__dirname', '__filename', 'module']);

/**
 * List the import specifiers of a source text: [{ spec, kind: 'static'|'dynamic'|'computed', line, text }].
 * Uses the bundler's analyser; falls back to a comment-aware regex scan for TypeScript syntax
 * the analyser does not know (import type, etc.).
 */
export function listImports(src, file) {
  const out = [];
  try {
    const a = analyzeModule(src, file);
    for (const l of a.links) out.push({ spec: l.spec, kind: 'static', line: lineCol(src, l.pos).line });
    for (const d of a.dynamics) {
      if (d.spec !== null) out.push({ spec: d.spec, kind: 'dynamic', line: lineCol(src, d.pos).line });
      else {
        const end = src.indexOf('\n', d.pos);
        out.push({ spec: null, kind: 'computed', line: lineCol(src, d.pos).line, text: src.slice(d.pos, end < 0 ? src.length : end).trim().slice(0, 140), candidates: d.candidates || [] });
      }
    }
    return out;
  } catch (e) {
    if (!(e instanceof BuildError)) throw e;
  }
  // Fallback: blank out comments, then scan with regular expressions.
  let code = src;
  try {
    code = tokenize(src, file).map((t) => (t.type === 'comment' ? t.text.replace(/[^\n]/g, ' ') : t.text)).join('');
  } catch { /* keep the raw text */ }
  const re = /\b(?:import|export)\b[^'"`;()]*?\bfrom\s*(['"])([^'"\n]+)\1|\bimport\s*(['"])([^'"\n]+)\3|\bimport\s*\(\s*(['"])([^'"\n]+)\5\s*[,)]|\bimport\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    const line = lineCol(code, m.index).line;
    if (m[2]) out.push({ spec: m[2], kind: 'static', line });
    else if (m[4]) out.push({ spec: m[4], kind: 'static', line });
    else if (m[6]) out.push({ spec: m[6], kind: 'dynamic', line });
    else out.push({ spec: null, kind: 'computed', line, text: code.slice(m.index, code.indexOf('\n', m.index)).trim().slice(0, 140), candidates: [] });
  }
  return out;
}

function nodeGlobalsUsed(src, file) {
  const found = new Map();
  let toks;
  try { toks = tokenize(src, file).filter((t) => t.type !== 'ws' && t.type !== 'comment'); } catch { return found; }
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type !== 'ident' || !NODE_GLOBALS.has(t.text) || found.has(t.text)) continue;
    const prev = toks[i - 1];
    const next = toks[i + 1];
    if (prev && (prev.text === '.' || prev.text === '?.')) continue;                  // a property
    if (prev && prev.type === 'ident' && prev.text === 'typeof') continue;           // feature test
    if (next && next.text === ':') continue;                                         // object key
    if (prev && prev.type === 'ident' && ['const', 'let', 'var', 'function'].includes(prev.text)) continue;
    if (t.text === 'require' && !(next && next.text === '(')) continue;
    if (t.text === 'module' && !(next && next.text === '.')) continue;
    found.set(t.text, lineCol(src, t.start).line);
  }
  return found;
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Collect and verify the upload set.
 * @returns {{ ready: boolean, exists: boolean, files: {name, content}[], table: Object[], errors: string[], warnings: string[] }}
 */
export function assemble({ project = PROJECT, fn = 'spherex' } = {}) {
  const errors = [];
  const warnings = [];
  const files = [];
  const indexFile = path.join(project, 'proxy', 'supabase', 'functions', fn, 'index.ts');
  const srcDir = path.join(project, 'proxy', 'src');
  const rel = (p) => path.relative(project, p).split(path.sep).join('/');

  const srcNames = fs.existsSync(srcDir)
    ? fs.readdirSync(srcDir).filter((f) => f.endsWith('.js') && !/\.test\.js$/.test(f) && fs.statSync(path.join(srcDir, f)).isFile()).sort()
    : [];
  const exists = fs.existsSync(indexFile);
  if (!exists) errors.push(`${rel(indexFile)} does not exist yet: there is no edge function entry point to deploy`);
  if (!fs.existsSync(srcDir)) errors.push(`${rel(srcDir)}/ does not exist yet`);
  else if (!srcNames.length) errors.push(`${rel(srcDir)}/ contains no modules yet`);

  const inSet = new Set(srcNames.map((f) => `src/${f}`));
  const edges = new Map(); // file name in the set -> names it imports
  const link = (from, to) => { if (!edges.has(from)) edges.set(from, new Set()); edges.get(from).add(to); };

  if (exists) {
    const content = fs.readFileSync(indexFile, 'utf8');
    files.push({ name: 'index.ts', content });
    const imports = listImports(content, rel(indexFile));
    if (!imports.length) warnings.push(`${rel(indexFile)}: no import found; expected at least "./src/handler.js"`);
    for (const im of imports) {
      const at = `${rel(indexFile)}:${im.line}`;
      if (im.spec === null) { errors.push(`${at}: computed import() in the entry point cannot be verified: ${im.text}`); continue; }
      if (!im.spec.startsWith('./src/')) {
        errors.push(`${at}: index.ts may import only from "./src/..." (the upload layout), found "${im.spec}"`);
        continue;
      }
      const name = path.posix.normalize(im.spec.slice(2));
      if (!inSet.has(name)) errors.push(`${at}: "${im.spec}" is not in the upload set (no proxy/${name}${/\.test\.js$/.test(name) ? '; test files are excluded' : ''})`);
      else link('index.ts', name);
    }
  }

  for (const f of srcNames) {
    const file = path.join(srcDir, f);
    const content = fs.readFileSync(file, 'utf8');
    files.push({ name: `src/${f}`, content });
    for (const im of listImports(content, rel(file))) {
      const at = `${rel(file)}:${im.line}`;
      if (im.spec === null) {
        const outside = (im.candidates || []).filter((c) => !inSet.has(path.posix.normalize(path.posix.join('src', c))));
        const literal = /['"`](\.\.?\/[^'"`]+)['"`]/.exec(im.text || '');
        const target = outside[0] || (literal && !inSet.has(path.posix.normalize(path.posix.join('src', literal[1]))) ? literal[1] : null);
        warnings.push(target
          ? `${at}: lazy import of "${target}", which is NOT in the upload set; it rejects if that code path runs in the edge function: ${im.text}`
          : `${at}: computed import() cannot be verified: ${im.text}`);
        continue;
      }
      const spec = im.spec;
      const bare = spec.replace(/^node:/, '').split('/')[0];
      if (spec.startsWith('node:') || BUILTINS.has(spec) || BUILTINS.has(bare)) {
        errors.push(`${at}: imports the Node built-in "${spec}"; proxy/src must be environment-neutral (Deno edge runtime)`);
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) { errors.push(`${at}: imports the URL "${spec}"; the function must be self-contained`); continue; }
      if (!spec.startsWith('./') && !spec.startsWith('../')) { errors.push(`${at}: imports the bare package "${spec}"; there are no dependencies`); continue; }
      const name = path.posix.normalize(path.posix.join('src', spec));
      if (/\.test\.js$/.test(name)) { errors.push(`${at}: imports the test file "${spec}", which is not uploaded`); continue; }
      if (!inSet.has(name)) {
        const onDisk = fs.existsSync(path.resolve(srcDir, spec));
        errors.push(`${at}: "${spec}" ${onDisk ? 'is outside the upload set (only proxy/src/*.js is uploaded)' : 'does not exist'}`);
        continue;
      }
      link(`src/${f}`, name);
    }
    for (const [name, line] of nodeGlobalsUsed(content, rel(file))) {
      warnings.push(`${rel(file)}:${line}: uses the Node global "${name}" without a typeof guard nearby; check that it cannot run in Deno`);
    }
  }

  // Which uploaded modules can the entry point actually reach? (informational)
  const reached = new Set();
  const todo = ['index.ts'];
  while (todo.length) {
    const n = todo.pop();
    if (reached.has(n)) continue;
    reached.add(n);
    for (const t of edges.get(n) || []) todo.push(t);
  }
  const unreachable = exists ? [...inSet].filter((n) => !reached.has(n)).sort() : [];
  const table = files.map((f) => ({ name: f.name, bytes: Buffer.byteLength(f.content), sha256: sha(f.content) }));
  return { ready: exists && errors.length === 0, exists, files, table, errors, warnings, unreachable, fn };
}

function main(argv) {
  const opt = { out: path.join(PROJECT, 'dist', 'edge'), fn: 'spherex', print: false, list: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--print') opt.print = true;
    else if (a === '--list') opt.list = true;
    else if (a === '--strict') opt.strict = true;
    else if (a === '--out' && argv[i + 1]) opt.out = path.resolve(argv[++i]);
    else if (a === '--function' && argv[i + 1]) opt.fn = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node tools/deploy-bundle.mjs [--print | --list] [--strict] [--out <dir>] [--function <name>]');
      return 0;
    } else { console.error(`unknown option ${a}`); return 1; }
  }
  const r = assemble({ fn: opt.fn });
  const say = opt.print ? console.error : console.log;
  const problems = opt.strict ? [...r.errors, ...r.warnings] : r.errors;
  if (!opt.strict) for (const w of r.warnings) say(`warning: ${w}`);
  for (const e of problems) say(`error: ${e}`);
  if (r.table.length) {
    say(`Edge function "${r.fn}": ${r.table.length} files, ${r.table.reduce((s, f) => s + f.bytes, 0)} bytes`);
    for (const f of r.table) say(`  ${f.name.padEnd(24)} ${String(f.bytes).padStart(8)}  ${f.sha256.slice(0, 12)}`);
    if (r.unreachable.length) say(`  (uploaded but not imported, directly or indirectly, by index.ts: ${r.unreachable.join(', ')})`);
  }
  if (problems.length) {
    say(r.exists ? `NOT READY: ${problems.length} problem${problems.length === 1 ? '' : 's'}; nothing written.` : 'NOT READY: the edge function entry point has not been written yet; nothing written.');
    return r.exists ? 1 : 2;
  }
  if (opt.print) {
    process.stdout.write(JSON.stringify(r.files, null, 2) + '\n');
  } else if (!opt.list) {
    fs.mkdirSync(opt.out, { recursive: true });
    const jsonFile = path.join(opt.out, 'files.json');
    fs.writeFileSync(jsonFile, JSON.stringify(r.files, null, 2) + '\n');
    const tree = path.join(opt.out, r.fn);
    fs.rmSync(tree, { recursive: true, force: true });
    for (const f of r.files) {
      const target = path.join(tree, f.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, f.content);
    }
    fs.writeFileSync(path.join(opt.out, 'manifest.json'), JSON.stringify({ function: r.fn, entrypoint: 'index.ts', createdAt: new Date().toISOString(), files: r.table, unreachable: r.unreachable, warnings: r.warnings }, null, 2) + '\n');
    const relOut = path.relative(process.cwd(), opt.out).split(path.sep).join('/') || '.';
    say(`READY: wrote ${relOut}/files.json (array of { name, content }), ${relOut}/manifest.json and the same files under ${relOut}/${r.fn}/`);
  } else {
    say('READY (nothing written: --list).');
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
