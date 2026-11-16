// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// tools/build.mjs - zero-dependency single-file bundler.
//
//   node tools/build.mjs [--minify] [--out <path>] [--api <url>] [--banner [text]]
//                        [--root <dir>] [--html <file>] [--meta <path>] [--asset-limit <bytes>]
//                        [--keep-dynamic] [--strict] [--no-check] [--quiet]
//
// Turns web/index.html + its stylesheets + the ES module graph reachable from its
// <script type="module"> tags into ONE self-contained HTML file (default dist/tombaugh.html) that
// makes no request other than the API calls the page itself issues. A second file,
// dist/tombaugh.meta.json, lists the modules, sizes, hashes and build time.
//
// How it works (no full parser, on purpose):
//   * a careful tokenizer (strings, nested template literals, regex literals, comments) finds the
//     top-level `import` / `export` statements and every dynamic `import("...")`;
//   * each module becomes a function registered in a tiny module registry; import statements
//     become registry calls hoisted to the top of that function, export statements become getters
//     on the module namespace object (so exported `let` stays live through namespaces);
//   * dependencies evaluate first, each module once, cycles behave like ESM as far as a
//     function-level rewrite allows (function declarations are visible early, other bindings are
//     refreshed when the dependency finishes evaluating);
//   * the result is syntax-checked with `node --check` and mapped back to source lines.
//
// Dynamic imports: import('./x.js') is bundled and resolved statically. A computed specifier such
// as import(`./plugins/${name}/index.js`) bundles every file that matches the pattern
// (./plugins/*/index.js, one path segment per star) and resolves at run time; a name that is not
// in the bundle rejects like a failed fetch. A module reachable ONLY through such a pattern that
// is broken (unresolved import, syntax error) is left out with a loud warning instead of failing
// the build, mirroring what the page does natively (it catches the rejection); --strict turns
// that into an error.
//
// Known, documented limits: no top-level await; named imports of an exported `let` that is
// reassigned later are a snapshot (namespace imports are live), with a warning when detected.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

export const HEADER_LINES = [
  '// Tombaugh - SPHEREx blink comparator. Apache-2.0.',
  '// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.',
];

/** Error with a precise source location; the CLI prints `message` and exits 1. */
export class BuildError extends Error {
  constructor(message, where) {
    super(where ? `${where}: ${message}` : message);
    this.name = 'BuildError';
    this.where = where || null;
  }
}

// ---------------------------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------------------------

const PUNCTUATORS = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=',
  '&=', '|=', '^=', '<<', '>>', '**',
];
const REGEX_AFTER_KEYWORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do',
  'else', 'yield', 'await',
]);
const BLOCK_AFTER_KEYWORD = new Set(['else', 'try', 'finally', 'do']);
const CONTROL_KEYWORDS = new Set(['if', 'while', 'for', 'with']);

function isWs(c) {
  return c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\v' || c === '\f' ||
    c === '\u00a0' || c === '\ufeff' || c === '\u2028' || c === '\u2029';
}
function isDigit(c) { return c >= '0' && c <= '9'; }
function isIdentStart(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$' || c > '\x7f';
}
function isIdentPart(c) { return isIdentStart(c) || isDigit(c); }

export function lineCol(src, pos) {
  let line = 1;
  let last = -1;
  for (let i = src.indexOf('\n'); i !== -1 && i < pos; i = src.indexOf('\n', i + 1)) {
    line++;
    last = i;
  }
  return { line, col: pos - last };
}

/**
 * Tokenize JavaScript source. Every character belongs to exactly one token, so joining the token
 * texts reproduces the input. Token types: ws, comment, string, template (one chunk of a template
 * literal: from a backtick or `}` up to `${` or the closing backtick), regex, num, ident, punct.
 * `depth` is the bracket nesting of the token (an opening bracket and its closing bracket share
 * the depth of the code around them).
 */
export function tokenize(src, file = '<source>') {
  const toks = [];
  const n = src.length;
  const stack = [];
  let prev = null;
  let i = 0;

  const fail = (msg, pos) => {
    const { line, col } = lineCol(src, pos);
    throw new BuildError(msg, `${file}:${line}:${col}`);
  };
  const push = (type, start, end, depth) => {
    const t = { type, start, end, text: src.slice(start, end), depth: depth ?? stack.length };
    toks.push(t);
    if (type !== 'ws' && type !== 'comment') prev = t;
    return t;
  };
  const regexAllowed = () => {
    if (!prev) return true;
    switch (prev.type) {
      case 'num': case 'string': case 'regex': return false;
      case 'template': return prev.text.endsWith('${');
      case 'ident': return REGEX_AFTER_KEYWORD.has(prev.text);
      default:
        if (prev.text === ')') return prev.ctl === true;
        if (prev.text === '}') return prev.block === true;
        if (prev.text === ']' || prev.text === '++' || prev.text === '--') return false;
        return true;
    }
  };
  const braceIsBlock = () => {
    if (!prev) return true;
    if (prev.type === 'ident') return BLOCK_AFTER_KEYWORD.has(prev.text) || !REGEX_AFTER_KEYWORD.has(prev.text);
    if (prev.type === 'punct') return prev.text === ';' || prev.text === '{' || prev.text === '}' || prev.text === ')' || prev.text === '=>';
    if (prev.type === 'template') return !prev.text.endsWith('${');
    return true;
  };
  // Scan one template chunk starting at `start` (a backtick or the `}` closing a substitution).
  const scanTemplate = (start) => {
    let j = start + 1;
    for (;;) {
      if (j >= n) fail('unterminated template literal', start);
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '`') { push('template', start, j + 1); return j + 1; }
      if (c === '$' && src[j + 1] === '{') {
        push('template', start, j + 2);
        stack.push({ ch: '${', pos: j });
        return j + 2;
      }
      j++;
    }
  };
  const scanRegex = (start) => {
    let inClass = false;
    for (let j = start + 1; j < n; j++) {
      const c = src[j];
      if (c === '\n' || c === '\r') return -1;
      if (c === '\\') { j++; continue; }
      if (inClass) { if (c === ']') inClass = false; continue; }
      if (c === '[') inClass = true;
      else if (c === '/') {
        j++;
        while (j < n && isIdentPart(src[j])) j++;
        return j;
      }
    }
    return -1;
  };

  if (src.startsWith('#!')) {
    let j = src.indexOf('\n');
    if (j < 0) j = n;
    toks.push({ type: 'comment', start: 0, end: j, text: src.slice(0, j), depth: 0, hashbang: true });
    i = j;
  }

  while (i < n) {
    const c = src[i];
    if (isWs(c)) {
      let j = i + 1;
      while (j < n && isWs(src[j])) j++;
      push('ws', i, j);
      i = j;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      let j = i + 2;
      while (j < n && src[j] !== '\n' && src[j] !== '\r' && src[j] !== '\u2028' && src[j] !== '\u2029') j++;
      push('comment', i, j);
      i = j;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      if (j < 0) fail('unterminated block comment', i);
      push('comment', i, j + 2);
      i = j + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      for (;;) {
        if (j >= n) fail('unterminated string literal', i);
        const d = src[j];
        if (d === '\\') { j += (src[j + 1] === '\r' && src[j + 2] === '\n') ? 3 : 2; continue; }
        if (d === '\n' || d === '\r') fail('unterminated string literal', i);
        if (d === c) break;
        j++;
      }
      push('string', i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '`') { i = scanTemplate(i); continue; }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] || ''))) {
      let j = i;
      if (c === '0' && /[xXoObB]/.test(src[i + 1] || '')) {
        j = i + 2;
        while (j < n && /[0-9a-fA-F_]/.test(src[j])) j++;
      } else {
        while (j < n && (isDigit(src[j]) || src[j] === '_')) j++;
        if (src[j] === '.') { j++; while (j < n && (isDigit(src[j]) || src[j] === '_')) j++; }
        if (src[j] === 'e' || src[j] === 'E') {
          let k = j + 1;
          if (src[k] === '+' || src[k] === '-') k++;
          if (isDigit(src[k] || '')) { j = k; while (j < n && (isDigit(src[j]) || src[j] === '_')) j++; }
        }
      }
      if (src[j] === 'n') j++;
      push('num', i, j);
      i = j;
      continue;
    }
    if (isIdentStart(c) || c === '\\' || (c === '#' && (isIdentStart(src[i + 1] || '') || src[i + 1] === '\\'))) {
      let j = i + 1;
      while (j < n) {
        const d = src[j];
        if (isIdentPart(d)) { j++; continue; }
        if (d === '\\' && src[j + 1] === 'u') {
          if (src[j + 2] === '{') { const e = src.indexOf('}', j); j = e < 0 ? n : e + 1; } else j += 6;
          continue;
        }
        break;
      }
      push('ident', i, j);
      i = j;
      continue;
    }
    if (c === '/') {
      if (regexAllowed()) {
        const j = scanRegex(i);
        if (j > 0) { push('regex', i, j); i = j; continue; }
      }
      const len = src[i + 1] === '=' ? 2 : 1;
      push('punct', i, i + len);
      i += len;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      const entry = { ch: c, pos: i };
      if (c === '(') entry.ctl = !!prev && prev.type === 'ident' && CONTROL_KEYWORDS.has(prev.text);
      if (c === '{') entry.block = braceIsBlock();
      push('punct', i, i + 1);
      stack.push(entry);
      i++;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      const top = stack[stack.length - 1];
      if (!top) fail(`unexpected "${c}"`, i);
      if (c === '}' && top.ch === '${') {
        stack.pop();
        i = scanTemplate(i);
        continue;
      }
      const want = top.ch === '(' ? ')' : top.ch === '[' ? ']' : '}';
      if (c !== want) fail(`unexpected "${c}" (expected "${want}" to close the bracket opened at line ${lineCol(src, top.pos).line})`, i);
      stack.pop();
      const t = push('punct', i, i + 1);
      if (c === ')') t.ctl = top.ctl;
      if (c === '}') t.block = top.block;
      i++;
      continue;
    }
    let matched = null;
    for (const p of PUNCTUATORS) {
      if (src.startsWith(p, i)) { matched = p; break; }
    }
    if (matched === '?.' && isDigit(src[i + 2] || '')) matched = null;
    const len = matched ? matched.length : 1;
    push('punct', i, i + len);
    i += len;
  }
  if (stack.length) {
    const top = stack[stack.length - 1];
    fail(`unclosed "${top.ch}"`, top.pos);
  }
  return toks;
}

// ---------------------------------------------------------------------------------------------
// Module analysis: find import / export statements and plan the edits
// ---------------------------------------------------------------------------------------------

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const NEEDS_OPERAND = new Set([
  'typeof', 'new', 'void', 'delete', 'in', 'instanceof', 'await', 'class', 'function', 'extends',
  'case', 'async',
]);

function stringValue(tok, file, src) {
  const where = () => { const { line, col } = lineCol(src, tok.start); return `${file}:${line}:${col}`; };
  let raw;
  if (tok.type === 'string') raw = tok.text.slice(1, -1);
  else if (tok.type === 'template' && tok.text.startsWith('`') && tok.text.endsWith('`') && tok.text.length >= 2) raw = tok.text.slice(1, -1);
  else return null;
  if (raw.includes('\\')) throw new BuildError(`escape sequences in a module specifier are not supported: ${tok.text}`, where());
  return raw;
}

/**
 * Work out which files a computed dynamic import can reach, e.g.
 * import(`./plugins/${name}/index.js`) or import('./plugins/' + name + '/index.js') give the
 * pattern "./plugins/*" + "/index.js" (a star stands for one path segment). `candidates` lists
 * every relative string literal inside the argument (covers `cond ? './a.js' : './b.js'`).
 */
function dynamicPattern(args, depth) {
  const candidates = [];
  for (const a of args) {
    if (a.type === 'string' && /^\.{1,2}\//.test(a.text.slice(1, -1)) && !a.text.includes('\\')) candidates.push(a.text.slice(1, -1));
  }
  const top = args.filter((a) => a.depth === depth);
  let pat = '';
  const star = () => { if (!pat.endsWith('*')) pat += '*'; };
  let i = 0;
  while (i < top.length) {
    const a = top[i];
    if (a.type === 'string' || a.type === 'template') {
      const body = a.type === 'string' ? a.text.slice(1, -1) : a.text.slice(1, a.text.endsWith('${') ? -2 : -1);
      if (body.includes('\\')) return { pattern: null, candidates };
      pat += body;
      if (a.type === 'template' && a.text.endsWith('${')) star();
      i++;
    } else if (a.type === 'punct' && a.text === '+') {
      i++;
    } else {
      star();
      while (i < top.length && !(top[i].type === 'punct' && top[i].text === '+')) i++;
    }
  }
  const ok = /^(?:\.{1,2})?\//.test(pat) && !pat.includes('**');
  return { pattern: ok ? pat : null, candidates };
}

/**
 * Analyse one module. Returns the token-level facts the bundler needs:
 * links (static imports and re-exports in source order), local exports, dynamic imports and
 * the text edits that turn the module into a plain function body.
 */
export function analyzeModule(src, file = '<source>') {
  const toks = tokenize(src, file);
  const sig = toks.filter((t) => t.type !== 'ws' && t.type !== 'comment');
  const at = (pos) => { const { line, col } = lineCol(src, pos); return `${file}:${line}:${col}`; };
  const fail = (msg, tok) => { throw new BuildError(msg, at(tok ? tok.start : src.length)); };

  const mod = {
    file,
    src,
    links: [],          // { kind: 'import'|'reexport', spec, pos, ... } in source order
    exports: new Map(), // exported name -> local identifier
    dynamics: [],       // { spec, pos, importTok, specTok }
    edits: [],          // { start, end, text }
    mutableExports: new Set(),
    reassigned: [],
    usesImportMeta: false,
    usesWorker: false,
  };
  const addExport = (name, local, tok) => {
    if (mod.exports.has(name) || mod.links.some((l) => l.kind === 'reexport' && (l.nsAs === name || (l.named || []).some((s) => s.exported === name)))) {
      fail(`duplicate export "${name}"`, tok);
    }
    mod.exports.set(name, local);
  };
  const tokText = (k) => (sig[k] ? sig[k].text : undefined);
  const isIdent = (k, text) => !!sig[k] && sig[k].type === 'ident' && (text === undefined || sig[k].text === text);
  const expect = (k, text, what) => {
    if (!sig[k] || sig[k].text !== text) fail(`expected ${what || `"${text}"`} but found ${sig[k] ? `"${sig[k].text}"` : 'end of file'}`, sig[k] || sig[k - 1]);
  };
  const matchClose = (k) => {
    // index of the bracket closing the one opened at sig[k]
    const d = sig[k].depth;
    for (let q = k + 1; q < sig.length; q++) {
      if (sig[q].depth === d && sig[q].type === 'punct' && (sig[q].text === ')' || sig[q].text === ']' || sig[q].text === '}')) return q;
      if (sig[q].depth === d && sig[q].type === 'template' && sig[q].text.startsWith('}')) return q;
    }
    fail('unbalanced bracket', sig[k]);
    return -1;
  };
  const newlineBetween = (a, b) => src.slice(a.end, b.start).includes('\n');
  // Skip optional import attributes and a semicolon; returns the index after the statement.
  const finishFrom = (k) => {
    if (isIdent(k) && (sig[k].text === 'with' || sig[k].text === 'assert') && tokText(k + 1) === '{') k = matchClose(k + 1) + 1;
    if (tokText(k) === ';') k++;
    return k;
  };
  const moduleName = (k) => {
    // an export/import name: identifier (keywords allowed) or string literal
    const t = sig[k];
    if (!t) fail('unexpected end of file in import/export list', sig[k - 1]);
    if (t.type === 'ident') return t.text;
    if (t.type === 'string') {
      const v = stringValue(t, file, src);
      if (!IDENT_RE.test(v)) fail(`string export names that are not identifiers are not supported: ${t.text}`, t);
      return v;
    }
    fail(`unexpected "${t.text}" in import/export list`, t);
    return '';
  };
  const parseList = (k, firstKey, secondKey) => {
    // sig[k] is "{"; returns [items, indexAfterClosingBrace]
    const items = [];
    k++;
    while (tokText(k) !== '}') {
      const first = moduleName(k);
      const firstTok = sig[k];
      k++;
      let second = first;
      if (isIdent(k, 'as')) { k++; second = moduleName(k); k++; }
      items.push({ [firstKey]: first, [secondKey]: second, tok: firstTok });
      if (tokText(k) === ',') k++;
      else if (tokText(k) !== '}') fail(`expected "," or "}" but found ${sig[k] ? `"${sig[k].text}"` : 'end of file'}`, sig[k] || sig[k - 1]);
    }
    return [items, k + 1];
  };
  const specAt = (k) => {
    if (!sig[k] || sig[k].type !== 'string') fail('expected a module specifier string', sig[k] || sig[k - 1]);
    return stringValue(sig[k], file, src);
  };
  // Collect the identifiers bound by a declaration pattern starting at sig[k]; returns index after it.
  const bindingNames = (k, names) => {
    const t = sig[k];
    if (!t) fail('unexpected end of file in declaration', sig[k - 1]);
    if (t.type === 'ident') { names.push(t.text); return k + 1; }
    if (t.text !== '{' && t.text !== '[') fail(`unsupported declaration pattern near "${t.text}"`, t);
    const close = matchClose(k);
    const inner = t.depth + 1;
    let q = k + 1;
    while (q < close) {
      // one element: tokens up to the next comma at depth `inner`
      let e = q;
      while (e < close && !(sig[e].depth === inner && sig[e].text === ',')) e++;
      let s = q;
      if (s < e && sig[s].text === '...') s++;
      if (s < e) {
        if (t.text === '{') {
          // `key: target`, `[computed]: target`, `key`, `key = default`
          let colon = -1;
          for (let z = s; z < e; z++) {
            if (sig[z].depth === inner && sig[z].text === ':') { colon = z; break; }
            if (sig[z].depth === inner && sig[z].text === '=') break;
          }
          if (colon >= 0) s = colon + 1;
        }
        if (s < e) {
          if (sig[s].type === 'ident') names.push(sig[s].text);
          else if (sig[s].text === '{' || sig[s].text === '[') bindingNames(s, names);
        }
      }
      q = e + 1;
    }
    return close + 1;
  };
  // Does a statement end between sig[k-1] and sig[k] (both at depth 0) by automatic semicolon insertion?
  const asiBreak = (k) => {
    const a = sig[k - 1];
    const b = sig[k];
    if (!b) return true;
    if (!newlineBetween(a, b)) return false;
    if (a.type === 'punct' && ![')', ']', '}', '++', '--'].includes(a.text)) return false;
    if (a.type === 'template' && a.text.endsWith('${')) return false;
    if (a.type === 'ident' && NEEDS_OPERAND.has(a.text)) return false;
    if (b.type === 'punct') return ['++', '--', '{', '!', '~'].includes(b.text);
    if (b.type === 'template') return false;
    if (b.type === 'ident') return !(b.text === 'in' || b.text === 'instanceof');
    return true;
  };
  const parseDeclarators = (k) => {
    // sig[k] is the first binding after const/let/var; returns names
    const names = [];
    for (;;) {
      k = bindingNames(k, names);
      if (tokText(k) === '=') {
        k++;
        for (;;) {
          const t = sig[k];
          if (!t) return names;
          if (t.depth === 0 && t.type === 'punct' && (t.text === ',' || t.text === ';')) break;
          if (t.depth === 0 && k > 0 && asiBreak(k)) return names;
          k++;
        }
      }
      if (tokText(k) === ',' && sig[k].depth === 0) { k++; continue; }
      return names;
    }
  };

  for (let k = 0; k < sig.length; k++) {
    const t = sig[k];
    if (t.type !== 'ident') continue;
    const before = sig[k - 1];
    const afterDot = !!before && before.type === 'punct' && (before.text === '.' || before.text === '?.');

    if (t.text === 'Worker' && before && before.text === 'new') mod.usesWorker = true;

    if (t.text === 'import' && !afterDot) {
      const next = sig[k + 1];
      if (next && next.text === '.') { mod.usesImportMeta = true; continue; }
      if (next && next.text === '(') {
        const close = matchClose(k + 1);
        if (tokText(close + 1) === '{') continue; // a method named "import"
        // first argument: tokens up to a comma at the argument depth
        const argDepth = next.depth + 1;
        let e = k + 2;
        while (e < close && !(sig[e].depth === argDepth && sig[e].text === ',')) e++;
        const args = sig.slice(k + 2, e);
        if (!args.length) fail('import() needs a specifier', t);
        const literal = args.length === 1 ? stringValue(args[0], file, src) : null;
        if (literal !== null) mod.dynamics.push({ spec: literal, pos: t.start, importTok: t, specTok: args[0] });
        else mod.dynamics.push({ spec: null, pos: t.start, importTok: t, openTok: next, ...dynamicPattern(args, argDepth) });
        continue;
      }
      if (t.depth !== 0) continue; // property name, shorthand etc.; a misplaced statement fails the syntax check
      if (next && next.text === ':') continue;
      // static import
      const link = { kind: 'import', spec: null, pos: t.start, def: null, ns: null, named: [] };
      let p = k + 1;
      if (sig[p] && sig[p].type === 'string') {
        link.spec = specAt(p);
        p++;
      } else {
        if (isIdent(p) && (tokText(p + 1) === ',' || isIdent(p + 1, 'from'))) {
          link.def = sig[p].text;
          p++;
          if (tokText(p) === ',') p++;
        }
        if (tokText(p) === '*') {
          if (!isIdent(p + 1, 'as') || !isIdent(p + 2)) fail('expected "* as name"', sig[p]);
          link.ns = sig[p + 2].text;
          p += 3;
        } else if (tokText(p) === '{') {
          const [items, q] = parseList(p, 'imported', 'local');
          link.named = items;
          p = q;
        }
        if (!isIdent(p, 'from')) fail(`unsupported import syntax near "${tokText(p) ?? 'end of file'}"`, sig[p] || t);
        link.spec = specAt(p + 1);
        p += 2;
      }
      p = finishFrom(p);
      mod.links.push(link);
      mod.edits.push({ start: t.start, end: sig[p - 1].end, text: ';' });
      k = p - 1;
      continue;
    }

    if (t.text === 'export' && !afterDot && t.depth === 0) {
      const next = sig[k + 1];
      if (!next) fail('unexpected end of file after "export"', t);
      if (next.text === ':') continue;
      if (next.text === '*') {
        const link = { kind: 'reexport', spec: null, pos: t.start, star: true, nsAs: null, named: [] };
        let p = k + 2;
        if (isIdent(p, 'as')) {
          link.star = false;
          link.nsAs = moduleName(p + 1);
          if (mod.exports.has(link.nsAs)) fail(`duplicate export "${link.nsAs}"`, sig[p + 1]);
          p += 2;
        }
        if (!isIdent(p, 'from')) fail('expected "from" after "export *"', sig[p] || t);
        link.spec = specAt(p + 1);
        p = finishFrom(p + 2);
        mod.links.push(link);
        mod.edits.push({ start: t.start, end: sig[p - 1].end, text: ';' });
        k = p - 1;
        continue;
      }
      if (next.text === '{') {
        const [items, q] = parseList(k + 1, 'local', 'exported');
        let p = q;
        if (isIdent(p, 'from')) {
          const link = { kind: 'reexport', spec: specAt(p + 1), pos: t.start, star: false, nsAs: null, named: [] };
          for (const it of items) {
            if (mod.exports.has(it.exported)) fail(`duplicate export "${it.exported}"`, it.tok);
            link.named.push({ imported: it.local, exported: it.exported });
          }
          mod.links.push(link);
          p += 2;
        } else {
          for (const it of items) addExport(it.exported, it.local, it.tok);
        }
        p = finishFrom(p);
        mod.edits.push({ start: t.start, end: sig[p - 1].end, text: ';' });
        k = p - 1;
        continue;
      }
      if (next.text === 'default') {
        let p = k + 2;
        const isAsyncFn = isIdent(p, 'async') && isIdent(p + 1, 'function') && !newlineBetween(sig[p], sig[p + 1]);
        if (isIdent(p, 'function') || isAsyncFn) {
          if (isAsyncFn) p++;
          p++; // after "function"
          if (tokText(p) === '*') p++;
          if (isIdent(p)) {
            addExport('default', sig[p].text, next);
          } else {
            addExport('default', '__tb_default', next);
            mod.edits.push({ start: sig[p - 1].end, end: sig[p - 1].end, text: ' __tb_default' });
          }
          mod.edits.push({ start: t.start, end: sig[k + 2].start, text: '' });
        } else if (isIdent(p, 'class')) {
          if (isIdent(p + 1) && sig[p + 1].text !== 'extends') {
            addExport('default', sig[p + 1].text, next);
          } else {
            addExport('default', '__tb_default', next);
            mod.edits.push({ start: sig[p].end, end: sig[p].end, text: ' __tb_default' });
          }
          mod.edits.push({ start: t.start, end: sig[k + 2].start, text: '' });
        } else {
          if (!sig[p]) fail('expected an expression after "export default"', next);
          addExport('default', '__tb_default', next);
          mod.edits.push({ start: t.start, end: next.end, text: 'const __tb_default =' });
        }
        k++;
        continue;
      }
      if (next.text === 'const' || next.text === 'let' || next.text === 'var') {
        const names = parseDeclarators(k + 2);
        if (!names.length) fail('could not find the names declared by this export', t);
        for (const name of names) {
          addExport(name, name, next);
          if (next.text !== 'const') mod.mutableExports.add(name);
        }
        mod.edits.push({ start: t.start, end: next.start, text: '' });
        k++;
        continue;
      }
      if (next.text === 'function' || next.text === 'class' || (next.text === 'async' && isIdent(k + 2, 'function'))) {
        let p = k + 2;
        if (next.text === 'async') p++;
        if (tokText(p) === '*') p++;
        if (!isIdent(p)) fail(`expected a name after "export ${next.text}"`, sig[p] || next);
        addExport(sig[p].text, sig[p].text, sig[p]);
        mod.edits.push({ start: t.start, end: next.start, text: '' });
        k++;
        continue;
      }
      fail(`unsupported export syntax: "export ${next.text} ..."`, t);
    }
  }

  // Best-effort detection of exported let/var bindings that are assigned again later.
  if (mod.mutableExports.size) {
    const assignOps = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??=', '++', '--']);
    const seen = new Set();
    for (let k = 0; k < sig.length; k++) {
      const t = sig[k];
      if (t.type !== 'ident' || !mod.mutableExports.has(t.text) || seen.has(t.text)) continue;
      const b = sig[k - 1];
      const a = sig[k + 1];
      if (b && b.type === 'punct' && (b.text === '.' || b.text === '?.')) continue;
      if (b && b.type === 'ident' && (b.text === 'let' || b.text === 'var')) continue;
      if (b && b.text === ',' && t.depth === 0) continue; // further declarator of the same statement (approximation)
      const pre = b && b.type === 'punct' && (b.text === '++' || b.text === '--');
      const post = a && a.type === 'punct' && assignOps.has(a.text);
      if (pre || post) { seen.add(t.text); mod.reassigned.push(t.text); }
    }
  }

  // Remove a hashbang line if present.
  if (toks.length && toks[0].hashbang) mod.edits.push({ start: 0, end: toks[0].end, text: '' });
  return mod;
}

/** Apply the planned edits, keeping the number of lines of every replaced region. */
function applyEdits(src, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = '';
  let pos = 0;
  for (const e of sorted) {
    if (e.start < pos) throw new BuildError(`internal error: overlapping edits at offset ${e.start}`);
    out += src.slice(pos, e.start);
    const removed = (src.slice(e.start, e.end).match(/\n/g) || []).length;
    const added = (e.text.match(/\n/g) || []).length;
    out += e.text + '\n'.repeat(Math.max(0, removed - added));
    pos = e.end;
  }
  return out + src.slice(pos);
}

const key = (name) => (IDENT_RE.test(name) ? name : JSON.stringify(name));
const prop = (name) => (IDENT_RE.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`);

// ---------------------------------------------------------------------------------------------
// Light, safe minification and inline-script escaping (both token based)
// ---------------------------------------------------------------------------------------------

/** Strip comments and collapse whitespace. Newlines are kept wherever one existed (ASI safe). */
export function minifyJs(code, file = '<bundle>') {
  const toks = tokenize(code, file);
  let out = '';
  let pending = null;
  for (const t of toks) {
    if (t.type === 'ws') {
      if (pending === '\n' || /[\n\r\u2028\u2029]/.test(t.text)) pending = '\n';
      else pending = ' ';
      continue;
    }
    if (t.type === 'comment' && !t.text.startsWith('/*!')) {
      if (t.text.startsWith('/*') && t.text.includes('\n')) pending = '\n';
      else if (pending === null) pending = ' ';
      continue;
    }
    if (pending !== null && out.length) out += pending;
    pending = null;
    out += t.text;
  }
  return out;
}

/** Make JavaScript safe to place inside <script>...</script> without changing its meaning. */
export function escapeInlineScript(code, file = '<bundle>') {
  if (!/<\/script|<script|<!--/i.test(code)) return code;
  const toks = tokenize(code, file);
  let out = '';
  for (const t of toks) {
    if (t.type === 'string' || t.type === 'template' || t.type === 'regex') out += t.text.replace(/<(?=\/script|script|!--)/gi, '\\x3C');
    else if (t.type === 'comment') out += t.text.replace(/<(?=\/script|script|!--)/gi, '< ');
    else out += t.text;
  }
  // What is left can only be operators in code position, where a space is harmless.
  return out.replace(/<(?=\/script|!--)/gi, '< ');
}

/** Strip CSS comments and indentation (strings and url() contents are left alone). */
export function minifyCss(css) {
  let out = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    const c = css[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && css[j] !== c) { if (css[j] === '\\') j++; j++; }
      out += css.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && css[i + 1] === '*') {
      const j = css.indexOf('*/', i + 2);
      i = j < 0 ? n : j + 2;
      out += ' ';
    } else { out += c; i++; }
  }
  return out.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------------------------
// Runtime prelude (kept tiny; names are prefixed __tb_)
// ---------------------------------------------------------------------------------------------

const RUNTIME = `const __tb_m = new Map();
const __tb_define = (id, fn) => { __tb_m.set(id, { fn, ns: Object.create(null, { [Symbol.toStringTag]: { value: 'Module' } }), st: 0, err: null, subs: [] }); };
const __tb_rec = (id) => { const r = __tb_m.get(id); if (!r) throw new Error('Tombaugh bundle: module not found: ' + id); return r; };
const __tb_ns = (id) => __tb_rec(id).ns;
const __tb_export = (ns, getters) => { for (const k of Object.keys(getters)) Object.defineProperty(ns, k, { enumerable: true, get: getters[k] }); };
const __tb_require = (id, bind) => {
  const r = __tb_rec(id);
  if (r.st === 0) {
    r.st = 1;
    try { r.fn.call(undefined, r.ns); r.st = 2; } catch (e) { r.st = 3; r.err = e; throw e; } finally { const s = r.subs; r.subs = []; for (const f of s) f(); }
  } else if (r.st === 3) throw r.err;
  if (bind) {
    const get = (k) => { try { return r.ns[k]; } catch (e) { return undefined; } };
    bind(get);
    if (r.st === 1) r.subs.push(() => bind(get));
  }
  return r.ns;
};
const __tb_import = (id) => Promise.resolve().then(() => __tb_require(id));
const __tb_dynamic = (dir, spec) => Promise.resolve().then(() => {
  const s = String(spec).replace(/[?#].*$/, '');
  let id = null;
  if (s.startsWith('./') || s.startsWith('../')) {
    const parts = dir ? dir.split('/') : [];
    for (const p of s.split('/')) { if (p === '..') parts.pop(); else if (p !== '.' && p !== '') parts.push(p); }
    id = parts.join('/');
  } else if (s.startsWith('/')) id = s.slice(1);
  if (id === null || !__tb_m.has(id)) throw new TypeError('Failed to fetch dynamically imported module: ' + spec + ' (it is not part of this single-file build)');
  return __tb_require(id);
});`;

// ---------------------------------------------------------------------------------------------
// HTML and CSS helpers
// ---------------------------------------------------------------------------------------------

const MIME = {
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

const isLocalRef = (ref) => !!ref && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref);
const stripQuery = (ref) => ref.replace(/[?#].*$/, '');

const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
function parseAttrs(raw) {
  const attrs = new Map();
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(raw))) {
    const name = m[1].toLowerCase();
    if (!attrs.has(name)) attrs.set(name, { value: m[2] ?? m[3] ?? m[4] ?? '', start: m.index, end: m.index + m[0].length });
  }
  return attrs;
}
const attrVal = (attrs, name) => (attrs.has(name) ? attrs.get(name).value : null);
const htmlAttrEscape = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const htmlAttrDecode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// ---------------------------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------------------------

/**
 * Build the single-file page.
 * @param {Object} [opts]
 * @param {string} [opts.root]   directory that holds the page (default <project>/web)
 * @param {string} [opts.html]   HTML file inside root (default index.html)
 * @param {string} [opts.out]    output path (default <project>/dist/tombaugh.html)
 * @param {string} [opts.meta]   meta JSON path (default: out with .meta.json)
 * @param {boolean} [opts.minify]
 * @param {string} [opts.api]    value for window.TOMBAUGH_API
 * @param {string} [opts.sounds] directory of recorded interface sounds (.wav, .mp3, .m4a, .ogg);
 *   each file becomes window.TOMBAUGH_SOUNDS[<file name without extension>] as a data URI
 * @param {boolean|string} [opts.banner]  true for the default banner comment, or custom text
 * @param {number} [opts.assetLimit]  largest asset to inline, bytes (default 512 kB)
 * @param {boolean} [opts.keepDynamic] leave dynamic import() of URLs / bare specifiers untouched
 * @param {boolean} [opts.strict] fail on anything that would otherwise be a warning about
 *   computed dynamic imports (unknown targets, broken modules reachable only through them)
 * @param {boolean} [opts.check]  syntax-check the bundle with `node --check` (default true)
 * @param {boolean} [opts.write]  write files (default true)
 * @returns {Promise<Object>} { html, js, meta, outFile, metaFile, warnings }
 */
export async function build(opts = {}) {
  const root = path.resolve(opts.root || path.join(PROJECT, 'web'));
  const htmlFile = path.resolve(root, opts.html || 'index.html');
  const outFile = path.resolve(opts.out || path.join(PROJECT, 'dist', 'tombaugh.html'));
  const metaFile = path.resolve(opts.meta || outFile.replace(/\.html?$/i, '') + '.meta.json');
  const assetLimit = Number.isFinite(opts.assetLimit) ? opts.assetLimit : 512 * 1024;
  const cwd = process.cwd();
  const show = (file) => {
    const rel = path.relative(cwd, file);
    return (rel && !rel.startsWith('..') ? rel : file).split(path.sep).join('/');
  };
  const warnings = [];
  const warn = (msg) => { if (!warnings.includes(msg)) warnings.push(msg); };

  if (!fs.existsSync(htmlFile)) throw new BuildError(`page not found: ${show(htmlFile)} (nothing to build yet)`);
  const html = fs.readFileSync(htmlFile, 'utf8');
  const htmlDir = path.dirname(htmlFile);
  const idOf = (file) => path.relative(root, file).split(path.sep).join('/');

  const assets = [];
  const dataUri = (file, where) => {
    const ext = path.extname(file).toLowerCase();
    const mime = MIME[ext];
    if (!mime) { warn(`${where}: asset type ${ext || '(none)'} is not inlined: ${show(file)}`); return null; }
    const buf = fs.readFileSync(file);
    if (buf.length > assetLimit) { warn(`${where}: asset larger than ${assetLimit} bytes is not inlined: ${show(file)} (${buf.length} bytes)`); return null; }
    if (!assets.some((a) => a.file === idOf(file))) assets.push({ file: idOf(file), bytes: buf.length, mime, sha256: sha256(buf) });
    return `data:${mime};base64,${buf.toString('base64')}`;
  };
  const resolveLocal = (ref, fromDir) => {
    const clean = stripQuery(htmlAttrDecode(ref));
    return clean.startsWith('/') ? path.join(root, clean) : path.resolve(fromDir, clean);
  };

  // ---- CSS -----------------------------------------------------------------------------------
  const cssFiles = [];
  const loadCss = (file, where, seen = new Set()) => {
    if (seen.has(file)) return '';
    if (!fs.existsSync(file)) throw new BuildError(`stylesheet not found: ${show(file)}`, where);
    seen.add(file);
    let css = fs.readFileSync(file, 'utf8');
    cssFiles.push({ file: idOf(file), bytes: Buffer.byteLength(css), sha256: sha256(css) });
    return processCss(css, file, seen);
  };
  const processCss = (cssIn, file, seen = new Set()) => {
    const dir = path.dirname(file);
    let css = cssIn.replace(/@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1\s*\)?\s*([^;]*);/g, (m, q, ref, media) => {
      if (!isLocalRef(ref)) { warn(`${show(file)}: external @import is left in place and will be requested at run time: ${ref}`); return m; }
      const inner = loadCss(resolveLocal(ref, dir), show(file), seen);
      return media.trim() ? `@media ${media.trim()} {\n${inner}\n}` : inner;
    });
    css = css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, q, ref) => {
      if (!isLocalRef(ref)) {
        if (/^(?:https?:)?\/\//i.test(ref)) warn(`${show(file)}: external url() will be requested at run time: ${ref}`);
        return m;
      }
      const target = resolveLocal(ref, dir);
      if (!fs.existsSync(target)) { warn(`${show(file)}: url() target not found: ${ref}`); return m; }
      const uri = dataUri(target, show(file));
      return uri ? `url("${uri}")` : m;
    });
    return css;
  };
  const finishCss = (css) => (opts.minify ? minifyCss(css) : css.replace(/\s+$/, '')).replace(/<\/(?=style)/gi, '<\\/');

  // ---- Module graph ----------------------------------------------------------------------------
  const modules = new Map(); // id -> record
  const order = [];          // evaluation-friendly order (dependencies first)
  const resolveSpec = (spec, importer, pos, dynamic) => {
    const where = () => { const { line, col } = lineCol(importer.src, pos); return `${show(importer.file)}:${line}:${col}`; };
    const clean = stripQuery(spec);
    if (/^[a-z][a-z0-9+.-]*:/i.test(spec) || spec.startsWith('//')) {
      if (dynamic && opts.keepDynamic) return null;
      throw new BuildError(`cannot bundle URL import "${spec}" (the page must not load code from the network${/^node:/.test(spec) ? '; node: built-ins do not exist in a browser' : ''})`, where());
    }
    if (!(clean.startsWith('./') || clean.startsWith('../') || clean.startsWith('/'))) {
      if (dynamic && opts.keepDynamic) return null;
      throw new BuildError(`bare module specifier "${spec}" cannot be resolved: only relative imports ("./x.js") are supported, there are no npm dependencies`, where());
    }
    const file = clean.startsWith('/') ? path.join(root, clean) : path.resolve(path.dirname(importer.file), clean);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      let hint = '';
      for (const ext of ['.js', '.mjs', '/index.js']) {
        if (fs.existsSync(file + ext) && fs.statSync(file + ext).isFile()) { hint = ` (did you mean "${spec}${ext}"? browsers do not add extensions)`; break; }
      }
      throw new BuildError(`unresolved import "${spec}": ${show(file)} does not exist${hint}`, where());
    }
    if (/\.test\.[cm]?js$/.test(file)) throw new BuildError(`"${spec}" is a test file and must not be imported by the page`, where());
    if (/(^|[./-])demo\.[cm]?js$/.test(path.basename(file))) warn(`${where()}: demo file ${show(file)} is part of the bundle because it is imported`);
    if (path.relative(root, file).startsWith('..')) warn(`${where()}: "${spec}" is outside ${show(root)}; it is bundled, but the unbundled page cannot load it`);
    return file;
  };
  // Files matched by a computed import() pattern such as "./plugins/*" + "/index.js".
  const globDynamic = (pattern, importerFile) => {
    const baseDir = pattern.startsWith('/') ? root : path.dirname(importerFile);
    const pat = pattern.startsWith('/') ? `.${pattern}` : pattern;
    const star = pat.indexOf('*');
    const staticDir = star < 0 ? pat.slice(0, pat.lastIndexOf('/') + 1) : pat.slice(0, pat.lastIndexOf('/', star) + 1);
    const re = new RegExp(`^${pat.split('*').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+')}$`);
    const found = [];
    const walk = (dir, depth) => {
      let ents;
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const ent of ents) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) { if (depth < 6 && ent.name !== 'node_modules' && !ent.name.startsWith('.')) walk(full, depth + 1); continue; }
        if (!/\.(?:[cm]?js|json)$/.test(ent.name) || /\.test\.[cm]?js$/.test(ent.name)) continue;
        let rel = path.relative(baseDir, full).split(path.sep).join('/');
        if (!rel.startsWith('../')) rel = `./${rel}`;
        if (re.test(rel)) found.push(full);
      }
    };
    walk(path.resolve(baseDir, staticDir || './'), 0);
    return found.sort();
  };
  // A module reached only through a computed import() may be broken without breaking the page
  // (the importer is expected to catch the rejection), so such a module is replaced by a stub
  // that throws, with a loud warning, instead of failing the whole build (unless --strict).
  const leftOut = [];
  const stubFor = (file, reason) => {
    const id = idOf(file);
    const short = String(reason).split('\n')[0];
    leftOut.push({ id, reason: short });
    warn(`${id} is LEFT OUT of the bundle (importing it will reject, as a failed fetch would): ${short}`);
    modules.delete(id);
    if (order.includes(id)) order.splice(order.indexOf(id), 1);
    return addModule(null, { id, file, display: show(file), src: `throw new Error(${JSON.stringify(`Tombaugh single-file build: "${id}" was left out: ${short}`)});\n` });
  };
  const softAdd = (file) => {
    const id = idOf(file);
    if (modules.has(id)) return id;
    const snapshot = new Set(modules.keys());
    const orderLen = order.length;
    try {
      return addModule(file).id;
    } catch (e) {
      if (!(e instanceof BuildError) || opts.strict) throw e;
      for (const k of [...modules.keys()]) if (!snapshot.has(k)) modules.delete(k);
      order.length = orderLen;
      return stubFor(file, e.message).id;
    }
  };
  const addModule = (file, virtual) => {
    const id = virtual ? virtual.id : idOf(file);
    if (modules.has(id)) return modules.get(id);
    let src;
    if (virtual) src = virtual.src;
    else if (file.toLowerCase().endsWith('.json')) {
      const text = fs.readFileSync(file, 'utf8');
      try { JSON.parse(text); } catch (e) { throw new BuildError(`invalid JSON: ${e.message}`, show(file)); }
      src = `export default ${text.trim()};\n`;
    } else src = fs.readFileSync(file, 'utf8').replace(/^\ufeff/, '');
    const displayFile = virtual ? virtual.display : show(file);
    const analysed = analyzeModule(src, displayFile);
    const rec = {
      id, file: virtual ? virtual.file : file, display: displayFile, src, analysed,
      bytes: Buffer.byteLength(src), sha256: sha256(src), deps: [], dynamicDeps: [], globDeps: [], virtual: !!virtual,
    };
    modules.set(id, rec);
    const importer = { file: rec.file, src };
    for (const link of analysed.links) {
      const target = resolveSpec(link.spec, importer, link.pos, false);
      link.id = addModule(target).id;
      if (!rec.deps.includes(link.id)) rec.deps.push(link.id);
    }
    order.push(id);
    for (const dyn of analysed.dynamics) {
      if (dyn.spec !== null) {
        const target = resolveSpec(dyn.spec, importer, dyn.pos, true);
        if (target === null) { warn(`${displayFile}: external dynamic import("${dyn.spec}") left untouched; it will fail at run time`); dyn.external = true; continue; }
        dyn.id = addModule(target).id;
        if (!rec.dynamicDeps.includes(dyn.id)) rec.dynamicDeps.push(dyn.id);
        continue;
      }
      // Computed specifier: bundle every file it can reach and resolve at run time.
      const { line, col } = lineCol(src, dyn.pos);
      const at = `${displayFile}:${line}:${col}`;
      const files = new Set();
      if (dyn.pattern) for (const f of globDynamic(dyn.pattern, rec.file)) files.add(f);
      for (const c of dyn.candidates) {
        const f = path.resolve(path.dirname(rec.file), stripQuery(c));
        if (fs.existsSync(f) && fs.statSync(f).isFile() && !/\.test\.[cm]?js$/.test(f)) files.add(f);
      }
      if (!dyn.pattern && !files.size) {
        if (opts.strict) throw new BuildError('computed dynamic import(): cannot tell which modules it loads (start the specifier with a literal "./dir/" prefix)', at);
        warn(`${at}: computed dynamic import(): cannot tell which modules it may load; only modules that are in the bundle anyway will resolve`);
      } else if (!files.size) warn(`${at}: dynamic import pattern "${dyn.pattern}" matches no file (yet)`);
      for (const f of [...files].sort()) {
        const gid = softAdd(f);
        if (!rec.globDeps.includes(gid)) rec.globDeps.push(gid);
      }
    }
    if (analysed.usesImportMeta) warn(`${displayFile}: uses import.meta; in the bundle import.meta.url is the page URL, so URLs relative to the module will not resolve`);
    if (analysed.usesWorker) warn(`${displayFile}: creates a Worker; worker scripts are not bundled`);
    return rec;
  };

  // ---- Walk the HTML -----------------------------------------------------------------------------
  const TAG_RE = /<!--[\s\S]*?-->|<(script|style)\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/\1\s*>|<(link|img|source)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  const pieces = [];
  const entries = [];
  let bundleSlot = -1;
  let last = 0;
  let inlineCount = 0;
  let m;
  const setAttr = (raw, attrs, name, value) => {
    const a = attrs.get(name);
    return `${raw.slice(0, a.start)}${name}="${htmlAttrEscape(value)}"${raw.slice(a.end)}`;
  };
  while ((m = TAG_RE.exec(html))) {
    pieces.push(html.slice(last, m.index));
    last = m.index + m[0].length;
    const whereHtml = () => `${show(htmlFile)}:${lineCol(html, m.index).line}`;
    if (m[0].startsWith('<!--')) { pieces.push(opts.minify ? '' : m[0]); continue; }
    const tag = (m[1] || m[4]).toLowerCase();
    const rawAttrs = m[1] ? m[2] : m[5];
    const attrs = parseAttrs(rawAttrs);
    if (tag === 'script') {
      const type = (attrVal(attrs, 'type') || '').trim().toLowerCase();
      const srcAttr = attrVal(attrs, 'src');
      if (type === 'module') {
        if (srcAttr !== null) {
          if (!isLocalRef(srcAttr)) throw new BuildError(`external module script cannot be bundled: ${srcAttr}`, whereHtml());
          const file = resolveLocal(srcAttr, htmlDir);
          if (!fs.existsSync(file)) throw new BuildError(`module script not found: ${show(file)}`, whereHtml());
          entries.push(addModule(file).id);
        } else if (m[3].trim()) {
          const id = `${idOf(htmlFile)}#module${inlineCount++}`;
          // keep line numbers of the inline script aligned with the HTML file for messages
          const pad = '\n'.repeat(lineCol(html, m.index + m[0].indexOf('>') + 1).line - 1);
          entries.push(addModule(null, { id, src: pad + m[3], file: htmlFile, display: show(htmlFile) }).id);
        }
        if (bundleSlot < 0) { bundleSlot = pieces.length; pieces.push(''); }
        continue;
      }
      if (srcAttr !== null && isLocalRef(srcAttr) && (type === '' || /javascript|ecmascript/.test(type))) {
        const file = resolveLocal(srcAttr, htmlDir);
        if (!fs.existsSync(file)) throw new BuildError(`script not found: ${show(file)}`, whereHtml());
        let js = fs.readFileSync(file, 'utf8');
        // Third-party files under vendor/ are already minified: they go in byte for byte.
        if (opts.minify && !/[\\/]vendor[\\/]/.test(file)) js = minifyJs(js, show(file));
        const keep = rawAttrs.slice(0, attrs.get('src').start) + rawAttrs.slice(attrs.get('src').end);
        pieces.push(`<script${keep.replace(/\s+$/, '')}>\n${escapeInlineScript(js, show(file))}\n</script>`);
        assets.push({ file: idOf(file), bytes: Buffer.byteLength(js), mime: 'text/javascript', sha256: sha256(js) });
        continue;
      }
      if (srcAttr !== null && !isLocalRef(srcAttr)) warn(`${whereHtml()}: external script will be requested at run time: ${srcAttr}`);
      pieces.push(m[0]);
      continue;
    }
    if (tag === 'style') {
      pieces.push(`<style${rawAttrs}>${finishCss(processCss(m[3], htmlFile))}</style>`);
      continue;
    }
    if (tag === 'link') {
      const rel = (attrVal(attrs, 'rel') || '').toLowerCase().split(/\s+/);
      const href = attrVal(attrs, 'href');
      if (href === null || !isLocalRef(href)) {
        if (href && /^(?:https?:)?\/\//i.test(href) && rel.some((r) => ['stylesheet', 'preload', 'modulepreload', 'icon'].includes(r))) {
          warn(`${whereHtml()}: external <link> will be requested at run time: ${href}`);
        }
        pieces.push(m[0]);
        continue;
      }
      if (rel.includes('stylesheet')) {
        const cssFile = resolveLocal(href, htmlDir);
        const rawCss = loadCss(cssFile, whereHtml());
        // Third-party stylesheets under vendor/ are already minified: they go in as they are.
        const css = /[\\/]vendor[\\/]/.test(cssFile) ? rawCss.replace(/\s+$/, '').replace(/<\/(?=style)/gi, '<\\/') : finishCss(rawCss);
        const media = attrVal(attrs, 'media');
        pieces.push(`<style${media ? ` media="${htmlAttrEscape(media)}"` : ''}>\n${css}\n</style>`);
        continue;
      }
      if (rel.includes('modulepreload') || rel.includes('preload') || rel.includes('prefetch')) continue; // nothing left to preload
      const file = resolveLocal(href, htmlDir);
      if (!fs.existsSync(file)) { warn(`${whereHtml()}: <link> target not found, tag removed: ${href}`); continue; }
      const uri = dataUri(file, whereHtml());
      if (uri) pieces.push(`<link${setAttr(rawAttrs, attrs, 'href', uri)}>`);
      else pieces.push(m[0]);
      continue;
    }
    // img / source
    const srcAttr = attrVal(attrs, 'src');
    if (srcAttr !== null && isLocalRef(srcAttr)) {
      const file = resolveLocal(srcAttr, htmlDir);
      if (fs.existsSync(file)) {
        const uri = dataUri(file, whereHtml());
        if (uri) { pieces.push(`<${tag}${setAttr(rawAttrs, attrs, 'src', uri)}>`); continue; }
      } else warn(`${whereHtml()}: <${tag}> source not found: ${srcAttr}`);
    }
    pieces.push(m[0]);
  }
  pieces.push(html.slice(last));
  if (!entries.length) throw new BuildError(`no <script type="module"> found in ${show(htmlFile)}; the contract says it loads src/main.js`);

  // ---- Validate named imports against the exports of their target ----------------------------
  const exportCache = new Map();
  const exportNames = (id, stack = new Set()) => {
    if (exportCache.has(id)) return exportCache.get(id);
    const a = modules.get(id).analysed;
    const names = new Set(a.exports.keys());
    for (const l of a.links) {
      if (l.kind !== 'reexport') continue;
      if (l.nsAs) names.add(l.nsAs);
      for (const s of l.named) names.add(s.exported);
    }
    if (stack.has(id)) return names;
    stack.add(id);
    for (const l of a.links) {
      if (l.kind === 'reexport' && l.star) for (const nme of exportNames(l.id, stack)) if (nme !== 'default') names.add(nme);
    }
    stack.delete(id);
    if (!stack.size) exportCache.set(id, names);
    return names;
  };
  const validateImports = () => {
   for (const rec of modules.values()) {
    const a = rec.analysed;
    for (const l of a.links) {
      const want = [];
      if (l.kind === 'import') {
        if (l.def) want.push({ name: 'default', pos: l.pos });
        for (const s of l.named) want.push({ name: s.imported, pos: s.tok.start });
      } else for (const s of l.named) want.push({ name: s.imported, pos: l.pos });
      if (!want.length) continue;
      const have = exportNames(l.id);
      for (const w of want) {
        if (have.has(w.name)) continue;
        const { line, col } = lineCol(rec.src, w.pos);
        const near = [...have].filter((h) => h.toLowerCase() === w.name.toLowerCase());
        const err = new BuildError(
          `"${l.spec}" (${modules.get(l.id).display}) has no export named "${w.name}"${near.length ? ` (did you mean "${near[0]}"?)` : ''}; it exports: ${[...have].sort().join(', ') || '(nothing)'}`,
          `${rec.display}:${line}:${col}`);
        err.moduleId = rec.id;
        throw err;
      }
    }
    for (const l of a.links) {
      if (l.kind !== 'import') continue;
      const target = modules.get(l.id).analysed;
      for (const s of l.named) {
        const local = target.exports.get(s.imported);
        if (local && target.reassigned.includes(local)) {
          warn(`${rec.display}: named import "${s.imported}" from "${l.spec}" is an exported let that is reassigned; the bundle gives a snapshot (use a namespace import or a getter function for live values)`);
        }
      }
    }
   }
  };

  // ---- Which static imports sit on a cycle? ----------------------------------------------------
  const reachCache = new Map();
  const reach = (id) => {
    if (reachCache.has(id)) return reachCache.get(id);
    const seen = new Set();
    const todo = [...modules.get(id).deps];
    while (todo.length) {
      const d = todo.pop();
      if (seen.has(d)) continue;
      seen.add(d);
      todo.push(...modules.get(d).deps);
    }
    reachCache.set(id, seen);
    return seen;
  };
  const cyclic = (from, to) => from === to || reach(to).has(from);
  const cycles = [];

  // ---- Render modules --------------------------------------------------------------------------
  const J = JSON.stringify;
  const render = (rec) => {
    const a = rec.analysed;
    const edits = [...a.edits];
    for (const d of a.dynamics) {
      if (d.external) continue;
      if (d.spec === null) {
        const dir = rec.id.includes('/') ? rec.id.slice(0, rec.id.lastIndexOf('/')) : '';
        edits.push({ start: d.importTok.start, end: d.openTok.end, text: `__tb_dynamic(${J(dir)}, ` });
        continue;
      }
      edits.push({ start: d.importTok.start, end: d.importTok.end, text: '__tb_import' });
      edits.push({ start: d.specTok.start, end: d.specTok.end, text: J(d.id) });
    }
    const body = applyEdits(rec.src, edits);
    const pre = [];
    const getters = [];
    const taken = new Set();
    for (const [name, local] of a.exports) { getters.push(`${key(name)}: () => ${local}`); taken.add(name); }
    for (const l of a.links) {
      if (l.kind !== 'reexport') continue;
      if (l.nsAs) { getters.push(`${key(l.nsAs)}: () => __tb_ns(${J(l.id)})`); taken.add(l.nsAs); }
      for (const s of l.named) { getters.push(`${key(s.exported)}: () => __tb_ns(${J(l.id)})${prop(s.imported)}`); taken.add(s.exported); }
    }
    for (const l of a.links) {
      if (l.kind !== 'reexport' || !l.star) continue;
      for (const name of [...exportNames(l.id)].sort()) {
        if (name === 'default' || a.exports.has(name)) continue;
        if (taken.has(name)) { if (!a.exports.has(name)) warn(`${rec.display}: "${name}" is provided by more than one export *; the first one wins`); continue; }
        taken.add(name);
        getters.push(`${key(name)}: () => __tb_ns(${J(l.id)})${prop(name)}`);
      }
    }
    // Module namespace objects list their keys in code-unit order.
    getters.sort((x, y) => { const kx = x.slice(0, x.indexOf(': () =>')); const ky = y.slice(0, y.indexOf(': () =>')); return kx < ky ? -1 : kx > ky ? 1 : 0; });
    if (getters.length) pre.push(`__tb_export(__tb_self, { ${getters.join(', ')} });`);
    for (const l of a.links) {
      if (l.kind === 'reexport') { pre.push(`__tb_require(${J(l.id)});`); continue; }
      const pairs = [];
      if (l.def) pairs.push(['default', l.def]);
      for (const s of l.named) pairs.push([s.imported, s.local]);
      if (l.ns) pre.push(`const ${l.ns} = __tb_require(${J(l.id)});`);
      if (!pairs.length) { if (!l.ns) pre.push(`__tb_require(${J(l.id)});`); continue; }
      if (cyclic(rec.id, l.id)) {
        if (!cycles.some((c) => c[0] === rec.id && c[1] === l.id)) cycles.push([rec.id, l.id]);
        pre.push(`let ${pairs.map((p) => p[1]).join(', ')}; __tb_require(${J(l.id)}, ($) => { ${pairs.map((p) => `${p[1]} = $(${J(p[0])});`).join(' ')} });`);
      } else {
        pre.push(`const { ${pairs.map((p) => (p[0] === p[1] ? p[0] : `${key(p[0])}: ${p[1]}`)).join(', ')} } = __tb_require(${J(l.id)});`);
      }
    }
    return { prelude: pre.join(' '), body };
  };

  const headerRe = new RegExp('^(\\s*)' + HEADER_LINES.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\r?\\n'));
  const lineMap = [];
  const assemble = (minify) => {
    if (!minify) lineMap.length = 0;
    const out = [
      ...HEADER_LINES,
      `// Single-file bundle of ${modules.size} modules, generated by tools/build.mjs. Edit the sources in web/, not this file.`,
      minify ? minifyJs(RUNTIME) : RUNTIME,
    ];
    let line = out.join('\n').split('\n').length + 1;
    for (const id of order) {
      const rec = modules.get(id);
      const r = render(rec);
      let body = r.body;
      // The two-line project header is stated once at the top of the bundle; blank the per-module copies.
      body = body.replace(headerRe, (m0, lead) => lead + HEADER_LINES.map(() => '').join('\n'));
      let code = `__tb_define(${J(id)}, function (__tb_self) {${r.prelude ? ' ' + r.prelude : ''} ${body}\n});`;
      if (minify) code = minifyJs(code, rec.display);
      code = escapeInlineScript(code, rec.display);
      if (!minify) lineMap.push({ id, display: rec.display, start: line, end: line + code.split('\n').length - 1 });
      rec.bundledBytes = Buffer.byteLength(code);
      out.push(code);
      line += code.split('\n').length;
    }
    if (entries.length === 1) out.push(`__tb_require(${J(entries[0])});`);
    else for (const e of entries) out.push(`try { __tb_require(${J(e)}); } catch (e) { (typeof reportError === 'function' ? reportError : console.error)(e); }`);
    return out.join('\n');
  };

  // Modules that are only reachable through a computed import() and turn out to be broken are
  // stubbed (see stubFor) and the bundle is assembled again.
  const softRootsReaching = (badId) => {
    const hard = new Set();
    const todo = [...entries];
    while (todo.length) {
      const id = todo.pop();
      if (hard.has(id) || !modules.has(id)) continue;
      hard.add(id);
      todo.push(...modules.get(id).deps, ...modules.get(id).dynamicDeps);
    }
    if (hard.has(badId)) return [];
    const roots = new Set();
    for (const r of modules.values()) for (const g of r.globDeps) if (!hard.has(g)) roots.add(g);
    const hit = [];
    for (const g of roots) {
      const seen = new Set();
      const t2 = [g];
      while (t2.length) {
        const id = t2.pop();
        if (seen.has(id) || !modules.has(id)) continue;
        seen.add(id);
        const r = modules.get(id);
        t2.push(...r.deps, ...r.dynamicDeps, ...r.globDeps);
      }
      if (seen.has(badId)) hit.push(g);
    }
    return hit;
  };
  const prune = () => {
    const live = new Set();
    const todo = [...entries];
    while (todo.length) {
      const id = todo.pop();
      if (live.has(id) || !modules.has(id)) continue;
      live.add(id);
      const r = modules.get(id);
      todo.push(...r.deps, ...r.dynamicDeps, ...r.globDeps);
    }
    for (const id of [...modules.keys()]) if (!live.has(id)) modules.delete(id);
    for (let i = order.length - 1; i >= 0; i--) if (!live.has(order[i])) order.splice(i, 1);
  };
  let plain;
  for (;;) {
    try {
      validateImports();
      plain = assemble(false);
      if (opts.check !== false) checkSyntax(plain, lineMap, 'bundle');
      break;
    } catch (e) {
      if (!(e instanceof BuildError) || !e.moduleId || opts.strict) throw e;
      const roots = softRootsReaching(e.moduleId);
      if (!roots.length) throw e;
      for (const g of roots) stubFor(modules.get(g).file, e.message);
      prune();
      exportCache.clear();
      reachCache.clear();
      cycles.length = 0;
    }
  }
  let js = plain;
  if (opts.minify) {
    js = assemble(true);
    if (opts.check !== false) checkSyntax(js, null, 'minified bundle');
  }

  // ---- Assemble the page -------------------------------------------------------------------------
  let inject = '';
  if (opts.api) {
    if (!/^(https?:\/\/|\/)/.test(opts.api)) throw new BuildError(`--api expects an http(s) URL or an absolute path, got "${opts.api}"`);
    inject = `<script>window.TOMBAUGH_API = ${JSON.stringify(opts.api).replace(/</g, '\\x3C')};</script>\n`;
  }
  const soundNames = [];
  if (opts.sounds) {
    const dir = path.resolve(opts.sounds);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new BuildError(`--sounds expects a directory, got "${opts.sounds}"`);
    const types = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' };
    const map = {};
    for (const name of fs.readdirSync(dir).sort()) {
      const type = types[path.extname(name).toLowerCase()];
      if (!type) continue;
      const buf = fs.readFileSync(path.join(dir, name));
      if (buf.length > 262144) throw new BuildError(`--sounds: ${name} is larger than 256 kB; interface sounds should be short clips`);
      const key = path.basename(name, path.extname(name));
      map[key] = `data:${type};base64,${buf.toString('base64')}`;
      soundNames.push(key);
    }
    if (!soundNames.length) throw new BuildError(`--sounds: no .wav, .mp3, .m4a or .ogg files in "${opts.sounds}"`);
    inject += `<script>window.TOMBAUGH_SOUNDS = ${JSON.stringify(map)};</script>\n`;
  }
  pieces[bundleSlot] = `${inject}<script type="module">\n${js}\n</script>`;
  let outHtml = pieces.join('');

  const builtAt = new Date(process.env.SOURCE_DATE_EPOCH ? Number(process.env.SOURCE_DATE_EPOCH) * 1000 : Date.now()).toISOString();
  let version = '0.0.0';
  try { version = JSON.parse(fs.readFileSync(path.join(PROJECT, 'package.json'), 'utf8')).version || version; } catch { /* optional */ }
  const sourceHash = sha256([...modules.values()].map((r) => `${r.id}:${r.sha256}`).concat(cssFiles.map((c) => `${c.file}:${c.sha256}`)).sort().join('\n') + '\n' + sha256(html));
  if (opts.banner) {
    const text = typeof opts.banner === 'string'
      ? opts.banner
      : `Tombaugh ${version} - SPHEREx blink comparator. Apache-2.0.\n` +
        'AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.\n' +
        `Single-file build of ${modules.size} modules, ${builtAt}, sources sha256 ${sourceHash.slice(0, 16)}.`;
    const comment = `<!--\n${text.replace(/--/g, '- -')}\n-->\n`;
    const doctype = /^\s*<!doctype[^>]*>\s*/i.exec(outHtml);
    outHtml = doctype ? outHtml.slice(0, doctype[0].length) + comment + outHtml.slice(doctype[0].length) : comment + outHtml;
  }

  // What will this page still fetch besides the API? (markup only; the bundled script is skipped)
  const markup = pieces.filter((_, i) => i !== bundleSlot).join('');
  for (const mm of markup.matchAll(/<!--[\s\S]*?-->|<(script|img|source|link)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    if (!mm[1]) continue;
    const tag = mm[1].toLowerCase();
    const attrs = parseAttrs(mm[2]);
    const ref = attrVal(attrs, tag === 'link' ? 'href' : 'src');
    if (!ref || /^(?:data:|blob:|#)/i.test(ref)) continue;
    if (tag === 'link' && !/stylesheet|icon|preload|prefetch|manifest/i.test(attrVal(attrs, 'rel') || '')) continue;
    warn(`the built page still requests ${ref} (<${tag}>)`);
  }
  const origins = [...new Set([...js.matchAll(/https?:\/\/[A-Za-z0-9.-]+(?::\d+)?/g)].map((x) => x[0]))].sort();

  const bytes = Buffer.byteLength(outHtml);
  const meta = {
    name: 'tombaugh',
    version,
    builtAt,
    page: idOf(htmlFile),
    entries,
    out: show(outFile),
    bytes,
    gzipBytes: zlib.gzipSync(outHtml, { level: 9 }).length,
    sha256: sha256(outHtml),
    sourcesSha256: sourceHash,
    minify: !!opts.minify,
    api: opts.api || null,
    sounds: soundNames,
    moduleCount: modules.size,
    modules: order.map((id) => {
      const r = modules.get(id);
      const lm = lineMap.find((l) => l.id === id);
      return {
        id, bytes: r.bytes, bundledBytes: r.bundledBytes, sha256: r.sha256,
        imports: r.deps, dynamicImports: [...new Set([...r.dynamicDeps, ...r.globDeps])],
        exports: [...exportNames(id)].sort(),
        ...(opts.minify || !lm ? {} : { bundleLines: [lm.start, lm.end] }),
      };
    }),
    styles: cssFiles,
    assets,
    cycles,
    leftOut,
    urlOrigins: origins,
    warnings,
  };

  if (opts.write !== false) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, outHtml);
    fs.mkdirSync(path.dirname(metaFile), { recursive: true });
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
  }
  return { html: outHtml, js, meta, outFile, metaFile, warnings };
}

function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }

/** Parse the generated script with `node --check`; map a failure back to the source module. */
function checkSyntax(js, lineMap, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tombaugh-build-'));
  const file = path.join(dir, 'bundle.mjs');
  try {
    fs.writeFileSync(file, js);
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status === 0) return;
    const err = String(r.stderr || '');
    const lineNo = Number((/bundle\.mjs:(\d+)/.exec(err) || [])[1] || 0);
    const message = (/^(SyntaxError: .*)$/m.exec(err) || [])[1] || err.trim().split('\n').pop() || 'syntax error';
    const codeLine = lineNo ? js.split('\n')[lineNo - 1] : '';
    let where = `${label} line ${lineNo}`;
    const hit = lineMap && lineMap.find((l) => lineNo >= l.start && lineNo <= l.end);
    if (hit) where = `${hit.display}:${lineNo - hit.start + 1}`;
    const moduleId = hit ? hit.id : null;
    const hint = /await/.test(message + codeLine) && /reserved word|await is only valid/.test(message)
      ? ' (top-level await is not supported by the bundler; wrap it in an async function)'
      : ' (the rewriter could not handle this construct, or the source itself is not valid JavaScript)';
    const failure = new BuildError(`${message}${hint}\n    ${codeLine.trim().slice(0, 160)}`, where);
    failure.moduleId = moduleId;
    throw failure;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------

const USAGE = `Usage: node tools/build.mjs [options]

  --out <path>          output file (default dist/tombaugh.html; meta goes next to it)
  --minify              strip comments and collapse whitespace (safe, no renaming)
  --api <url>           inject window.TOMBAUGH_API = "<url>" before the bundle
  --sounds <dir>        build recorded interface sounds into the page: every .wav, .mp3, .m4a
                        or .ogg file in <dir> becomes window.TOMBAUGH_SOUNDS[<name>]. Without
                        it the page generates its own sounds. Only use files you may ship.
  --banner [text]       add an HTML comment after the doctype (default text: name, licence,
                        AI-generated notice, build time and source hash)
  --root <dir>          page directory (default web)
  --html <file>         page file inside the root (default index.html)
  --meta <path>         where to write the meta JSON
  --asset-limit <n>     largest local asset to inline as a data URI, bytes (default 524288)
  --keep-dynamic        leave dynamic import() of URLs or bare specifiers untouched (warn only)
  --strict              fail instead of warning when a computed import() has unknown targets or
                        a module reachable only through one is broken (default: such a module
                        is left out and importing it rejects, like a failed fetch)
  --no-check            skip the node --check syntax validation of the bundle
  --quiet               print errors only
  -h, --help            this text`;

export function parseArgs(argv) {
  const o = {};
  const need = (i, flag) => {
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new BuildError(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--minify': o.minify = true; break;
      case '--out': o.out = need(i, a); i++; break;
      case '--api': o.api = need(i, a); i++; break;
      case '--sounds': o.sounds = need(i, a); i++; break;
      case '--root': o.root = need(i, a); i++; break;
      case '--html': o.html = need(i, a); i++; break;
      case '--meta': o.meta = need(i, a); i++; break;
      case '--asset-limit': o.assetLimit = Number(need(i, a)); i++; break;
      case '--banner':
        if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { o.banner = argv[i + 1]; i++; } else o.banner = true;
        break;
      case '--keep-dynamic': o.keepDynamic = true; break;
      case '--strict': o.strict = true; break;
      case '--no-check': o.check = false; break;
      case '--quiet': o.quiet = true; break;
      case '-h': case '--help': o.help = true; break;
      default: throw new BuildError(`unknown option ${a}\n\n${USAGE}`);
    }
  }
  return o;
}

const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} kB`);

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
    if (o.help) { console.log(USAGE); return 0; }
    const started = Date.now();
    const r = await build(o);
    if (!o.quiet) {
      for (const w of r.warnings) console.warn(`warning: ${w}`);
      const m = r.meta;
      console.log(`${m.out}  ${kb(m.bytes)} (${kb(m.gzipBytes)} gzipped)  ${m.moduleCount} modules, ${m.styles.length} stylesheet${m.styles.length === 1 ? '' : 's'}, ${m.assets.length} inlined asset${m.assets.length === 1 ? '' : 's'}${m.minify ? ', minified' : ''}${m.api ? `, API ${m.api}` : ''}`);
      console.log(`sha256 ${m.sha256}  built in ${Date.now() - started} ms  meta: ${path.relative(process.cwd(), r.metaFile).split(path.sep).join('/')}`);
    }
    return 0;
  } catch (e) {
    if (e instanceof BuildError) { console.error(`build failed: ${e.message}`); return 1; }
    console.error(e);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
