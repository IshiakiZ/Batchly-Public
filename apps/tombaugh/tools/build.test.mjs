// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// tools/build.test.mjs - tests for the single-file bundler. Run: node --test tools/build.test.mjs
//
// The core check is behavioural: a fixture module graph that uses every import/export form is
// (a) served unbundled and run as native ES modules in headless Chromium and (b) bundled into one
// HTML file and opened from a file:// URL. Both must compute exactly the same result object,
// with no console errors and (for the bundle) no request other than the file itself.

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build, tokenize, analyzeModule, minifyJs, minifyCss, escapeInlineScript, parseArgs, BuildError, HEADER_LINES } from './build.mjs';
import { loadPlaywright, startStaticServer } from '../test/e2e-lib.mjs';
import { checkHeaders, headerProblem, withHeader } from './check-headers.mjs';
import { assemble as assembleEdge, listImports } from './deploy-bundle.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD_CLI = path.join(HERE, 'build.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tombaugh-build-test-'));

/** Write a fixture tree: { 'relative/path': string | Buffer }. Returns its directory. */
function fixture(name, files) {
  const dir = path.join(TMP, name);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const HDR = HEADER_LINES.join('\n') + '\n';

// ---------------------------------------------------------------------------------------------
// The kitchen-sink fixture
// ---------------------------------------------------------------------------------------------

const KITCHEN = {
  'index.html': `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>fixture</title>
<link rel="stylesheet" href="styles.css">
<link rel="icon" href="icon.svg">
<link rel="modulepreload" href="src/main.js">
</head>
<body>
<!-- <script type="module" src="src/never.js"></script> -->
<h1 id="h">fixture</h1>
<img id="logo" src="img/dot.png" alt="">
<pre id="out"></pre>
<script type="module" src="src/main.js"></script>
</body>
</html>
`,
  'styles.css': `@import "extra.css";
/* a comment with </style> and the word import */
#h { color: rgb(1, 2, 3); background-image: url("img/dot.png"); }
`,
  'extra.css': '#out { margin-left: 7px; }\n',
  'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#E53C27"/></svg>\n',
  'img/dot.png': PNG_1X1,
  'src/data.json': '{ "answer": 42, "text": "import me </script>" }\n',

  'src/order.js': `${HDR}export const order = [];
export function mark(name) { order.push(name); }
`,
  'src/side.js': `import { mark } from './order.js';
mark('side');
globalThis.__side = (globalThis.__side || 0) + 1;
`,
  'src/side2.js': `import { mark } from './order.js'
mark('side2')
`,
  'src/math.js': `#!/usr/bin/env node
${HDR}import { mark } from './order.js';
mark('math');
export const PI2 = 6.28, E = 2.72;
export let counter = 0;
export var legacy = 'var';
export function inc() { counter++; return counter; }
export async function later(v) { return v; }
export function* gen() { yield 1; yield 2; }
export async function* agen() { yield 'a'; }
export class Vec {
  constructor(x) { this.x = x; }
  len() { return Math.abs(this.x); }
}
export const { a: destructA, b: [destructB, ...destructRest], c: { d: destructD = 'dflt' } = {} } = { a: 1, b: [2, 3, 4] };
export const [first, , third = 'third'] = ['first', 'skip'];
export const arrow = (x) => x * 2, another = function () { return 'fn'; }
export const noSemi = 5
export const afterNoSemi = noSemi + 1
export const multiline = [
  1,
  2,
].map((v) => v
  * 10)
  .join('-')
export const obj = {
  import: 'prop-import',
  export: 'prop-export',
}, afterObj = 'after-obj'
export default 'math-default';
`,
  'src/default-named.js': `import { mark } from './order.js';
mark('default-named');
export default function namedDefault() { return 'named-default:' + namedDefault.name; }
`,
  'src/default-anon.js': `export default function () { return 'anon-default'; }
`,
  'src/default-gen.js': `export default function* () { yield 'gen-default'; }
`,
  'src/default-expr.js': `const v = { k: 'expr-default' };
export default v.k + '!';
`,
  'src/default-class.js': `export default class { hi() { return 'anon-class'; } }
`,
  'src/default-class-named.js': `export default class Named extends Object { hi() { return 'named-class:' + Named.name; } }
`,
  'src/default-async.js': `export default async function () { return 'async-default'; }
`,
  'src/default-arrow.js': `export default (x) => x + 1;
`,
  'src/default-object.js': `export default {
  import: 1,
  from: './nope.js',
};
`,
  'src/list.js': `import { mark } from './order.js';
mark('list');
const one = 1;
function two() { return 2; }
class Three { static tag = 'three'; }
let later = 'early';
export { one, two as deux, Three as default, later };
later = 'late';
export { one as "uno" }
(function () { globalThis.__iife = (globalThis.__iife || 0) + 1; })();
`,
  'src/reexport.js': `import { mark } from './order.js';
mark('reexport');
export { PI2, inc as increment } from './math.js';
export * from './list.js';
export * as mathNs from './math.js';
export {
  default as namedDefault2,
  default,
} from './default-named.js';
export const own = 'own';
`,
  'src/star-a.js': `export const shared = 'from-a', onlyA = 'a';
export default 'a-default';
`,
  'src/star-b.js': `export * from './star-a.js';
export const onlyB = 'b';
export const shared = 'from-b';
`,
  'src/tricky.js': `// import { nope } from './nope.js';
/* export default 42; import('./nope.js') */
/**
 * import x from "./nope.js"
 */
export const s1 = "import x from './nope.js'";
export const s2 = 'export default 1; import("./nope.js")';
export const t1 = \`import \${'a' + \`nested \${"export { x }"} import('./nope.js')\`} from './nope.js'\`;
export const re = /import\\(['"]\\.\\/nope\\.js['"]\\)/;
export const reClass = /[/"'\`]import/.test('"import');
export const div = 100 / 2 / 5; // a / that is not a regex: import
const o = { import: 1, export: 2, from: 3, default: 4, as: 5 };
export const viaProps = o.import + o.export + o.from + o.default + o.as;
class K {
  import(x) { return x; }
  export() { return 'm'; }
  static from = 1;
}
export const viaMethods = new K().import(5) + new K().export();
export const script = '</script><script>alert(1)</script><!-- x -->';
export const tpl = \`</script>\${1 + 1}<!--\`;
export const reScript = /<\\/script>|<!--/.test('<!--');
export const lt = ((a, b) => a<! --b)(-1, 1);
export const afterIf = (() => { let hit = 0; if (true) /re/.test('re') && hit++; return hit; })();
export const optional = o?.import ?? 0;
export const ternaryRegex = true ? /a\\/b/.source : 'x';
const from = 'kw-from', as = 'kw-as';
export { from, as };
label: for (;;) { break label; }
`,
  'src/cyc-a.js': `import { mark } from './order.js';
import { bValue, callA } from './cyc-b.js';
mark('cyc-a');
export function aFn() { return 'a-fn'; }
export const aConst = 'a-const';
export function useB() { return bValue + ':' + callA(); }
`,
  'src/cyc-b.js': `import { mark } from './order.js';
import { aFn, aConst } from './cyc-a.js';
import * as aNs from './cyc-a.js';
mark('cyc-b');
export const bValue = 'b:' + aFn();
export function callA() { return aConst + ':' + aNs.aConst; }
`,
  'src/lazy.js': `import { mark } from './order.js';
mark('lazy');
export const lazy = 'lazy-loaded';
export default 'lazy-default';
`,
  'src/lazy2.js': `import { mark } from './order.js';
import { lazy } from './lazy.js';
mark('lazy2');
export const lazy2 = lazy + '+2';
`,
  'src/broken-lazy.js': `throw new Error('lazy boom');
`,
  // Files that must never end up in the bundle:
  'src/math.test.js': `import test from 'node:test';
import { PI2 } from './math.js';
test('x', () => { if (PI2 !== 6.28) throw new Error('no'); });
`,
  'src/demo.html': '<!doctype html><script type="module" src="./demo.js"></script>\n',
  'src/demo.js': `import { PI2 } from './math.js';
document.body.textContent = String(PI2);
`,
  'src/main.js': `${HDR}import './side.js';
import mathDefault, { PI2, E as euler, inc, later, gen, agen, Vec, destructA, destructB, destructRest, destructD, first, third, arrow, another, noSemi, afterNoSemi, multiline, legacy, obj, afterObj } from './math.js';
import * as math from './math.js';
import anon from './default-anon.js';
import genDefault from './default-gen.js';
import named, * as defNs from './default-named.js';
import exprDefault from './default-expr.js';
import AnonClass from './default-class.js';
import NamedClass from './default-class-named.js';
import asyncDefault from './default-async.js';
import arrowDefault from './default-arrow.js';
import objectDefault from './default-object.js';
import Three, { one, deux, later as listLater, uno as unoString } from './list.js';
import {
  PI2 as pi2Again,
  increment,
  one as uno,
  deux as zwei, // trailing comment with the word import
  mathNs,
  namedDefault2,
  default as reDefault,
  own,
} from './reexport.js';
import * as star from './star-b.js';
import * as tricky from './tricky.js';
import { from as kwFrom, as } from './tricky.js';
import { useB } from './cyc-a.js';
import data from './data.json' with { type: 'json' };
import {} from './side2.js';
import { order, mark } from './order.js';

mark('main');

const out = {};
out.static = {
  mathDefault, PI2, euler, legacy, destructA, destructB, destructRest, destructD, first, third,
  arrow: arrow(21), another: another(), noSemi, afterNoSemi, multiline, obj, afterObj,
  gen: [...gen()], vec: new Vec(-3).len(),
  anon: anon(), genDefault: [...genDefault()], named: named(), defNsKeys: Object.keys(defNs), defNsSame: defNs.default === named,
  exprDefault, anonClass: new AnonClass().hi(), namedClass: new NamedClass().hi(), arrowDefault: arrowDefault(41),
  objectDefault,
  three: Three.tag, one, deux: deux(), listLater, unoString,
  pi2Again, uno, zwei: zwei(), own,
  mathNsSame: mathNs === math, mathNsTag: Object.prototype.toString.call(math), mathKeys: Object.keys(math),
  namedDefault2: namedDefault2(), reDefaultSame: reDefault === named,
  star: { ...star }, starKeys: Object.keys(star),
  kwFrom, as,
  data,
  cycle: useB(),
  side: globalThis.__side, iife: globalThis.__iife,
  nsFrozen: (() => { try { math.PI2 = 1; return 'assignable'; } catch (e) { return e.constructor.name; } })(),
  thisAtTop: typeof this,
};
// live bindings through a namespace object
const before = math.counter;
inc();
increment();
out.live = { before, after: math.counter, viaReexportNs: mathNs.counter };
out.tricky = { ...tricky, re: tricky.re.source };

async function run() {
  out.async = {
    later: await later('later'),
    asyncDefault: await asyncDefault(),
    agen: await (async () => { const r = []; for await (const v of agen()) r.push(v); return r; })(),
  };
  const orderBeforeLazy = order.slice();
  const lazyNs = await import('./lazy.js');
  const again = await import("./lazy.js");
  const lazy2 = await import(\`./lazy2.js\`);
  const inTemplate = \`<\${(await import('./lazy.js')).lazy}>\`;
  const viaThen = await import('./lazy.js').then((m) => m.default);
  const withOptions = (await import('./data.json', { with: { type: 'json' } })).default.answer;
  let broken;
  try { await import('./broken-lazy.js'); broken = 'no error'; } catch (e) { broken = e.message; }
  let brokenAgain;
  try { await import('./broken-lazy.js'); brokenAgain = 'no error'; } catch (e) { brokenAgain = e.message; }
  out.dynamic = {
    orderBeforeLazy, lazy: lazyNs.lazy, lazyDefault: lazyNs.default, same: lazyNs === again,
    lazy2: lazy2.lazy2, inTemplate, viaThen, withOptions, broken, brokenAgain, keys: Object.keys(lazyNs),
  };
  out.order = order.slice();
  document.getElementById('out').textContent = JSON.stringify(out, null, 1);
  window.__result = JSON.parse(JSON.stringify(out));
  window.__done = true;
}
run().catch((e) => { window.__result = { error: String(e && e.stack || e) }; window.__done = true; });
`,
};

// ---------------------------------------------------------------------------------------------
// Browser plumbing
// ---------------------------------------------------------------------------------------------

let browser = null;
let browserError = null;

before(async () => {
  try {
    const { chromium } = await loadPlaywright();
    browser = await chromium.launch();
  } catch (e) { browserError = e; }
});
after(async () => {
  if (browser) await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

/** Open a URL, wait for window.__done, return { result, errors, requests, page probes }. */
async function runPage(url, probe) {
  assert.ok(browser, `headless Chromium is required for this test: ${browserError && browserError.message}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  page.on('request', (r) => requests.push(r.url()));
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__done === true, null, { timeout: 15000 }).catch(() => {});
    const result = await page.evaluate(() => window.__result);
    const extra = probe ? await page.evaluate(probe) : null;
    return { result, errors, requests, extra };
  } finally {
    await context.close();
  }
}

const domProbe = () => ({
  color: getComputedStyle(document.getElementById('h')).color,
  background: getComputedStyle(document.getElementById('h')).backgroundImage.slice(0, 26),
  margin: getComputedStyle(document.getElementById('out')).marginLeft,
  imgWidth: document.getElementById('logo').naturalWidth,
  icon: (document.querySelector('link[rel=icon]') || {}).href || null,
  stylesheets: document.querySelectorAll('link[rel=stylesheet]').length,
  preloads: document.querySelectorAll('link[rel=modulepreload]').length,
  externalScripts: document.querySelectorAll('script[src]').length,
  api: window.TOMBAUGH_API ?? null,
});

// ---------------------------------------------------------------------------------------------
// Tokenizer and rewriter units
// ---------------------------------------------------------------------------------------------

describe('tokenizer', () => {
  const types = (src) => tokenize(src).filter((t) => t.type !== 'ws').map((t) => `${t.type}:${t.text}`);

  test('round-trips every character', () => {
    for (const src of Object.values(KITCHEN)) {
      if (typeof src !== 'string') continue;
      if (/<!doctype|^[#@]|^<svg|^\{/.test(src)) continue;
      assert.equal(tokenize(src).map((t) => t.text).join(''), src);
    }
  });

  test('tells regex literals from division', () => {
    assert.deepEqual(types('a / b / c'), ['ident:a', 'punct:/', 'ident:b', 'punct:/', 'ident:c']);
    assert.deepEqual(types('x = /im[/]port/g.test(y)').slice(2, 3), ['regex:/im[/]port/g']);
    assert.deepEqual(types('f(x) / 2 / y').filter((t) => t.startsWith('regex')), []);
    assert.deepEqual(types('if (x) /re/.test(y)').filter((t) => t.startsWith('regex')), ['regex:/re/']);
    assert.deepEqual(types('return /a/').filter((t) => t.startsWith('regex')), ['regex:/a/']);
    assert.deepEqual(types('a++ / 2 / b').filter((t) => t.startsWith('regex')), []);
    assert.deepEqual(types('x = a[0] / 2 / b').filter((t) => t.startsWith('regex')), []);
    assert.deepEqual(types('x /= 2').filter((t) => t.startsWith('punct')), ['punct:/=']);
  });

  test('handles nested template literals and keeps code inside ${} visible', () => {
    const toks = tokenize('const s = `a ${ `b ${ import("./x.js") } c` } d`;').filter((t) => t.type !== 'ws');
    assert.deepEqual(toks.filter((t) => t.type === 'template').map((t) => t.text), ['`a ${', '`b ${', '} c`', '} d`']);
    assert.ok(toks.some((t) => t.type === 'ident' && t.text === 'import'));
    assert.equal(tokenize('`import ${"`"} from`').filter((t) => t.type === 'ident').length, 0);
  });

  test('comments and strings hide keywords', () => {
    const idents = tokenize('// import a\n/* export b */ "import c" \'export d\'').filter((t) => t.type === 'ident');
    assert.equal(idents.length, 0);
  });

  test('reports unbalanced input with a location', () => {
    assert.throws(() => tokenize('function f() {\n  return (1;\n}', 'x.js'), (e) => e instanceof BuildError && /x\.js:3:1/.test(e.message));
    assert.throws(() => tokenize('const s = "abc\n', 'x.js'), /x\.js:1:11: unterminated string/);
    assert.throws(() => tokenize('const s = `abc', 'x.js'), /unterminated template/);
  });
});

describe('module analysis', () => {
  test('finds static imports, re-exports, exports and dynamic imports', () => {
    const a = analyzeModule(`
      import d, { a, b as c } from './one.js';
      import * as ns from "./two.js";
      import './three.js';
      export { x, y as z } from './four.js';
      export * from './five.js';
      export const k = 1, [m, n] = [2, 3];
      export default class {}
      const lazy = () => import('./six.js');
      const s = "import('./seven.js')";
    `, 'm.js');
    assert.deepEqual(a.links.map((l) => `${l.kind}:${l.spec}`), ['import:./one.js', 'import:./two.js', 'import:./three.js', 'reexport:./four.js', 'reexport:./five.js']);
    assert.equal(a.links[0].def, 'd');
    assert.deepEqual(a.links[0].named.map((s) => `${s.imported}>${s.local}`), ['a>a', 'b>c']);
    assert.equal(a.links[1].ns, 'ns');
    assert.deepEqual([...a.exports.keys()], ['k', 'm', 'n', 'default']);
    assert.deepEqual(a.dynamics.map((d) => d.spec), ['./six.js']);
  });

  test('does not treat members and methods named import/export as statements', () => {
    const a = analyzeModule('const o = { import: 1, export: 2 };\no.import = o.export;\nclass K { import(x) { return x; } }\nexport const v = o;\n', 'm.js');
    assert.equal(a.links.length, 0);
    assert.equal(a.dynamics.length, 0);
    assert.deepEqual([...a.exports.keys()], ['v']);
  });

  test('rejects syntax it cannot rewrite, with file:line:col', () => {
    assert.throws(() => analyzeModule('const a = 1;\nexport = a;\n', 'bad.js'), /bad\.js:2:1: unsupported export syntax/);
    assert.throws(() => analyzeModule('export const a = 1;\nexport { a };\n', 'dup.js'), /dup\.js:2:10: duplicate export "a"/);
    assert.throws(() => analyzeModule('import { a as } from "./x.js";', 'imp.js'), /imp\.js:1:/);
  });

  test('detects exported let bindings that are reassigned', () => {
    assert.deepEqual(analyzeModule('export let n = 0;\nexport function bump() { n += 1; }\nexport let fixed = 1;\n').reassigned, ['n']);
  });
});

describe('minify and escaping', () => {
  test('minifyJs strips comments, keeps strings, templates and line breaks', () => {
    const src = 'const a = 1; // gone\n/* gone\n too */\nconst s = "  // kept  ";\n   const t = `  /* kept */\n   indent`;\nreturn\na + +b';
    const min = minifyJs(src);
    assert.ok(!min.includes('gone'));
    assert.ok(min.includes('"  // kept  "'));
    assert.ok(min.includes('`  /* kept */\n   indent`'));
    assert.ok(min.includes('return\na + +b'));
    assert.ok(min.length < src.length);
  });

  test('escapeInlineScript neutralises </script> and <!-- without changing values', () => {
    const src = 'const a = "</script><!--", b = `</SCRIPT>${1}<script>`, c = /<\\/script>/, d = x</script>/.source.length; // </script> <!--';
    const esc = escapeInlineScript(src);
    assert.ok(!/<\/script|<!--|<script/i.test(esc), esc);
    const value = (code) => new Function('x', code.replace('; //', '; return [a, b, c.source, d]; //'))(1);
    assert.deepEqual(value(esc), value(src));
  });

  test('minifyCss keeps strings and url() intact', () => {
    assert.equal(minifyCss('  a { content: "/* no */"; }  /* yes */\n\n  b { color: red; }\n'), 'a { content: "/* no */"; }\nb { color: red; }');
  });

  test('parseArgs', () => {
    assert.deepEqual(parseArgs(['--minify', '--out', 'x.html', '--api', 'https://a/b', '--banner']), { minify: true, out: 'x.html', api: 'https://a/b', banner: true });
    assert.deepEqual(parseArgs(['--banner', 'hello', '--minify']), { banner: 'hello', minify: true });
    assert.throws(() => parseArgs(['--out']), /needs a value/);
    assert.throws(() => parseArgs(['--nope']), /unknown option/);
  });
});

// ---------------------------------------------------------------------------------------------
// Behaviour: native modules versus the bundle
// ---------------------------------------------------------------------------------------------

describe('bundle behaviour in headless Chromium', () => {
  let dir;
  let native;

  before(async () => {
    dir = fixture('kitchen', KITCHEN);
    if (!browser) return;
    const server = await startStaticServer(dir);
    try {
      native = await runPage(`${server.url}/index.html`, domProbe);
    } finally {
      await server.close();
    }
  });

  test('the fixture works as native ES modules (reference run)', () => {
    assert.ok(native, `no reference run: ${browserError && browserError.message}`);
    assert.deepEqual(native.errors, []);
    assert.ok(native.result && !native.result.error, JSON.stringify(native.result).slice(0, 600));
    const r = native.result;
    // Spot checks so that "both runs agree" cannot mean "both are empty".
    assert.equal(r.static.mathDefault, 'math-default');
    assert.equal(r.static.arrow, 42);
    assert.equal(r.static.multiline, '10-20');
    assert.deepEqual(r.static.gen, [1, 2]);
    assert.equal(r.static.cycle, 'b:a-fn:a-const:a-const');
    assert.deepEqual(r.live, { before: 0, after: 2, viaReexportNs: 2 });
    assert.equal(r.static.star.shared, 'from-b');
    assert.deepEqual(r.static.starKeys, ['onlyA', 'onlyB', 'shared']);
    assert.equal(r.static.listLater, 'late');
    assert.equal(r.tricky.script, '</script><script>alert(1)</script><!-- x -->');
    assert.equal(r.tricky.viaMethods, '5m');
    assert.equal(r.dynamic.lazy, 'lazy-loaded');
    assert.equal(r.dynamic.broken, 'lazy boom');
    assert.equal(r.dynamic.brokenAgain, 'lazy boom');
    assert.equal(r.dynamic.inTemplate, '<lazy-loaded>');
    assert.equal(r.static.data.answer, 42);
    assert.deepEqual(r.dynamic.orderBeforeLazy, ['side', 'math', 'default-named', 'list', 'reexport', 'cyc-b', 'cyc-a', 'side2', 'main']);
    assert.deepEqual(r.order.slice(-2), ['lazy', 'lazy2']);
  });

  for (const minify of [false, true]) {
    test(`the ${minify ? 'minified ' : ''}bundle computes exactly what native modules compute`, async () => {
      const out = path.join(dir, 'dist', minify ? 'min.html' : 'plain.html');
      const r = await build({ root: dir, out, minify });
      assert.ok(fs.existsSync(out));
      const run = await runPage(pathToFileURL(out).href, domProbe);
      assert.deepEqual(run.errors, []);
      assert.ok(run.result && !run.result.error, JSON.stringify(run.result).slice(0, 600));
      assert.deepEqual(run.result, native.result);
      // one file, nothing else requested
      assert.deepEqual(run.requests.filter((u) => !u.startsWith('data:')), [pathToFileURL(out).href]);
      // CSS and assets were inlined
      assert.equal(run.extra.color, 'rgb(1, 2, 3)');
      assert.equal(run.extra.margin, '7px');
      assert.equal(run.extra.imgWidth, 1);
      assert.ok(run.extra.background.startsWith('url("data:image/png;base64'));
      assert.ok(run.extra.icon.startsWith('data:image/svg+xml;base64,'));
      assert.equal(run.extra.stylesheets, 0);
      assert.equal(run.extra.preloads, 0);
      assert.equal(run.extra.externalScripts, 0);
      assert.equal(run.extra.api, null);
      assert.equal(r.meta.minify, minify);
    });
  }

  test('minified output is smaller and keeps the AI-generated notice', async () => {
    const plain = await build({ root: dir, write: false });
    const min = await build({ root: dir, write: false, minify: true });
    assert.ok(min.html.length < plain.html.length);
    for (const b of [plain, min]) {
      assert.ok(b.js.startsWith(HEADER_LINES.join('\n')));
      assert.equal(b.js.split(HEADER_LINES[1]).length - 1, 1, 'header appears once, not once per module');
    }
    assert.ok(!min.js.includes('trailing comment'));
  });

  test('tests and demo files are excluded; comments in HTML are not entries', async () => {
    const r = await build({ root: dir, write: false });
    const ids = r.meta.modules.map((m) => m.id);
    assert.ok(ids.includes('src/main.js') && ids.includes('src/lazy2.js') && ids.includes('src/data.json'));
    assert.ok(!ids.some((id) => /test|demo|never/.test(id)), ids.join(', '));
    assert.ok(!r.html.includes('node:test'));
    assert.deepEqual(r.meta.entries, ['src/main.js']);
    assert.ok(r.meta.cycles.some((c) => c.join('>') === 'src/cyc-b.js>src/cyc-a.js'));
  });

  test('meta file lists modules, sizes and a sha256 that matches the output', async () => {
    const out = path.join(dir, 'dist', 'meta-check.html');
    const r = await build({ root: dir, out });
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'dist', 'meta-check.meta.json'), 'utf8'));
    const bytes = fs.readFileSync(out);
    assert.equal(meta.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.equal(meta.bytes, bytes.length);
    assert.equal(meta.moduleCount, meta.modules.length);
    assert.equal(meta.moduleCount, r.meta.moduleCount);
    assert.ok(!Number.isNaN(Date.parse(meta.builtAt)));
    const main = meta.modules.find((m) => m.id === 'src/main.js');
    assert.equal(main.bytes, Buffer.byteLength(KITCHEN['src/main.js']));
    assert.ok(main.imports.includes('src/math.js'));
    assert.deepEqual(main.dynamicImports.sort(), ['src/broken-lazy.js', 'src/data.json', 'src/lazy.js', 'src/lazy2.js']);
    assert.deepEqual(meta.styles.map((s) => s.file).sort(), ['extra.css', 'styles.css']);
    assert.deepEqual(meta.assets.map((a) => a.file).sort(), ['icon.svg', 'img/dot.png']);
    // line numbers in the bundle map back to the sources
    const lines = r.js.split('\n');
    const math = meta.modules.find((m) => m.id === 'src/math.js');
    const srcLine = KITCHEN['src/math.js'].split('\n').findIndex((l) => l.includes('export const noSemi')) + 1;
    assert.ok(lines[math.bundleLines[0] + srcLine - 2].includes('const noSemi = 5'));
  });

  test('--api injects window.TOMBAUGH_API before the modules run, --banner adds a comment', async () => {
    const out = path.join(dir, 'dist', 'api.html');
    const r = await build({ root: dir, out, api: 'https://example.test/functions/v1/spherex', banner: true });
    assert.match(r.html, /^<!doctype html>\n<!--\nTombaugh [\d.]+ - SPHEREx blink comparator\. Apache-2\.0\.\nAI-generated code: written by Claude \(Anthropic\)/);
    assert.ok(r.html.indexOf('window.TOMBAUGH_API') < r.html.indexOf('__tb_define('));
    const run = await runPage(pathToFileURL(out).href, domProbe);
    assert.deepEqual(run.errors, []);
    assert.equal(run.extra.api, 'https://example.test/functions/v1/spherex');
    assert.deepEqual(run.result, native.result);
    const custom = await build({ root: dir, write: false, banner: 'custom -- text' });
    assert.ok(custom.html.includes('<!--\ncustom - - text\n-->'));
    await assert.rejects(build({ root: dir, write: false, api: 'not a url' }), /--api expects/);
  });

  test('command line: prints size and module count, exit code 0', () => {
    const out = path.join(dir, 'dist', 'cli.html');
    const r = spawnSync(process.execPath, [BUILD_CLI, '--root', dir, '--out', out, '--minify'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /cli\.html\s+[\d.]+ kB \([\d.]+ kB gzipped\)\s+\d+ modules/);
    assert.match(r.stdout, /sha256 [0-9a-f]{64}/);
    assert.ok(fs.existsSync(out) && fs.existsSync(out.replace('.html', '.meta.json')));
  });
});

describe('inline module scripts, several entries, classic scripts', () => {
  test('are bundled in document order', async () => {
    const dir = fixture('inline', {
      'index.html': `<!doctype html>
<html><head><title>t</title>
<style>body { background: url(dot.png); } /* </style in a comment */</style>
<script src="classic.js"></script>
</head><body>
<script type="module">
  import { tag } from './src/x.js';
  window.__log.push('inline:' + tag);
</script>
<script type="module" src="./src/second.js"></script>
<script type="module">
  import('./src/x.js').then((m) => { window.__result = { log: window.__log.concat('dyn:' + m.tag), classic: window.__classic }; window.__done = true; });
</script>
</body></html>
`,
      'classic.js': 'window.__classic = "classic </scr" + "ipt>"; window.__log = ["classic"]; // </script>\n',
      'dot.png': PNG_1X1,
      'src/x.js': 'window.__log.push("x");\nexport const tag = "x-tag";\n',
      'src/second.js': 'import { tag } from "./x.js";\nwindow.__log.push("second:" + tag);\n',
    });
    const server = await startStaticServer(dir);
    let native;
    try { native = await runPage(`${server.url}/index.html`); } finally { await server.close(); }
    assert.deepEqual(native.errors, []);
    assert.deepEqual(native.result, { log: ['classic', 'x', 'inline:x-tag', 'second:x-tag', 'dyn:x-tag'], classic: 'classic </script>' });
    const out = path.join(dir, 'dist', 'out.html');
    const r = await build({ root: dir, out });
    assert.deepEqual(r.meta.entries, ['index.html#module0', 'src/second.js', 'index.html#module1']);
    const run = await runPage(pathToFileURL(out).href);
    assert.deepEqual(run.errors, []);
    assert.deepEqual(run.result, native.result);
    assert.deepEqual(run.requests.filter((u) => !u.startsWith('data:')), [pathToFileURL(out).href]);
  });

  test('an error thrown by a module surfaces as an uncaught page error, like native modules', async () => {
    const dir = fixture('throws', {
      'index.html': '<!doctype html><title>t</title><script type="module" src="main.js"></script>',
      'main.js': 'import "./dep.js";\nwindow.__after = true;\n',
      'dep.js': 'window.__done = true;\nthrow new Error("dep failed");\n',
    });
    const out = path.join(dir, 'dist', 'out.html');
    await build({ root: dir, out });
    const run = await runPage(pathToFileURL(out).href, () => ({ after: window.__after === true }));
    assert.deepEqual(run.errors, ['pageerror: dep failed']);
    assert.equal(run.extra.after, false);
  });
});

describe('computed dynamic imports (the plugin loader pattern)', () => {
  const files = {
    'index.html': '<!doctype html><title>t</title><script type="module" src="src/main.js"></script>',
    'src/main.js': `import { PLUGINS } from './plugins/index.js';
const log = [];
const app = { tools: [] };
async function run() {
  for (const name of PLUGINS) {
    try {
      const m = await import(\`./plugins/\${name}/index.js\`);
      m.install(app);
      log.push(name + ':ok:' + m.meta.id);
    } catch (e) {
      log.push(name + ':skipped:' + (e instanceof Error));
    }
  }
  const which = 'b';
  try { log.push('concat:' + (await import('./extras/' + which + '.js')).v); } catch (e) { log.push('concat:skipped'); }
  const pick = (flag) => import(flag ? './choice/yes.js' : './choice/no.js');
  log.push('ternary:' + (await pick(true)).v + (await pick(false)).v);
  window.__result = { log, tools: app.tools, unlisted: window.__unlisted === true };
  window.__done = true;
}
run();
`,
    'src/plugins/index.js': "export const PLUGINS = ['alpha', 'beta', 'broken', 'unresolved', 'ghost'];\n",
    'src/core/util.js': "export const shout = (s) => s.toUpperCase();\n",
    'src/plugins/alpha/index.js': "import { shout } from '../../core/util.js';\nexport const meta = { id: 'alpha' };\nexport function install(app) { app.tools.push(shout('alpha')); }\n",
    'src/plugins/alpha/index.test.js': "import test from 'node:test';\ntest('x', () => {});\n",
    'src/plugins/alpha/demo.html': '<!doctype html><script type="module" src="./index.js"></script>',
    'src/plugins/beta/index.js': "import { tool } from './helper.js';\nexport const meta = { id: 'beta' };\nexport function install(app) { app.tools.push(tool); }\n",
    'src/plugins/beta/helper.js': "export const tool = 'beta-tool';\n",
    'src/plugins/broken/index.js': "export const meta = ;\nexport function install() {}\n",
    'src/plugins/unresolved/index.js': "import { nothing } from './not-written-yet.js';\nexport const meta = { id: 'unresolved' };\nexport function install() { nothing(); }\n",
    'src/plugins/unlisted/index.js': "window.__unlisted = true;\nexport const meta = { id: 'unlisted' };\nexport function install() {}\n",
    'src/extras/a.js': "export const v = 'a';\n",
    'src/extras/b.js': "export const v = 'b';\n",
    'src/choice/yes.js': "export const v = 'y';\n",
    'src/choice/no.js': "export const v = 'n';\n",
  };
  const expected = {
    log: ['alpha:ok:alpha', 'beta:ok:beta', 'broken:skipped:true', 'unresolved:skipped:true', 'ghost:skipped:true', 'concat:b', 'ternary:yn'],
    tools: ['ALPHA', 'beta-tool'],
    unlisted: false,
  };

  test('every module the pattern can reach is bundled; broken ones are left out, loudly', async () => {
    const dir = fixture('plugins', files);
    const server = await startStaticServer(dir);
    let native;
    try { native = await runPage(`${server.url}/index.html`); } finally { await server.close(); }
    assert.deepEqual(native.result, expected); // natively the broken plugins reject and are skipped

    const out = path.join(dir, 'dist', 'out.html');
    const r = await build({ root: dir, out });
    const ids = r.meta.modules.map((m) => m.id);
    for (const id of ['src/plugins/alpha/index.js', 'src/plugins/beta/helper.js', 'src/plugins/unlisted/index.js', 'src/extras/a.js', 'src/extras/b.js', 'src/choice/yes.js', 'src/choice/no.js']) {
      assert.ok(ids.includes(id), `${id} missing from ${ids.join(', ')}`);
    }
    assert.ok(!ids.some((id) => /\.test\.js$|not-written-yet/.test(id)));
    assert.deepEqual(r.meta.leftOut.map((l) => l.id).sort(), ['src/plugins/broken/index.js', 'src/plugins/unresolved/index.js']);
    assert.ok(r.warnings.some((w) => /src\/plugins\/broken\/index\.js is LEFT OUT.*SyntaxError/.test(w)), r.warnings.join('\n'));
    assert.ok(r.warnings.some((w) => /src\/plugins\/unresolved\/index\.js is LEFT OUT.*unresolved import "\.\/not-written-yet\.js"/.test(w)), r.warnings.join('\n'));
    const run = await runPage(pathToFileURL(out).href);
    assert.deepEqual(run.errors, []);
    assert.deepEqual(run.result, expected);
    assert.deepEqual(run.requests.filter((u) => !u.startsWith('data:')), [pathToFileURL(out).href]);

    const min = path.join(dir, 'dist', 'min.html');
    await build({ root: dir, out: min, minify: true });
    assert.deepEqual((await runPage(pathToFileURL(min).href)).result, expected);
  });

  test('--strict turns a broken pattern-only module into a build failure', async () => {
    const dir = fixture('plugins-strict', files);
    await assert.rejects(build({ root: dir, write: false, strict: true }), /src\/plugins\/(broken\/index\.js:1: SyntaxError|unresolved\/index\.js:1:1: unresolved import)/);
  });

  test('a broken module that the page imports statically still fails the build', async () => {
    const dir = fixture('plugins-hard', { ...files, 'src/plugins/index.js': "import './broken/index.js';\nexport const PLUGINS = [];\n" });
    await assert.rejects(build({ root: dir, write: false }), /src\/plugins\/broken\/index\.js:1: SyntaxError/);
  });

  test('a pattern that matches nothing yet is a warning', async () => {
    const dir = fixture('plugins-none', {
      'index.html': files['index.html'],
      'src/main.js': 'export const load = (n) => import(`./plugins/${n}/index.js`).catch(() => null);\n',
    });
    const r = await build({ root: dir, write: false });
    assert.ok(r.warnings.some((w) => /pattern "\.\/plugins\/\*\/index\.js" matches no file/.test(w)), r.warnings.join('\n'));
  });
});

// ---------------------------------------------------------------------------------------------
// Failure modes
// ---------------------------------------------------------------------------------------------

describe('precise failures', () => {
  const page = '<!doctype html><title>t</title><script type="module" src="src/main.js"></script>';
  const failing = (name, files) => build({ root: fixture(name, { 'index.html': page, ...files }), write: false });

  test('bare specifier', async () => {
    await assert.rejects(failing('bare', { 'src/main.js': '// x\nimport _ from "lodash";\n' }),
      (e) => e instanceof BuildError && /src\/main\.js:2:1: bare module specifier "lodash"/.test(e.message));
  });

  test('node: built-in and URL imports', async () => {
    await assert.rejects(failing('nodebuiltin', { 'src/main.js': 'import fs from "node:fs";\n' }), /main\.js:1:1: cannot bundle URL import "node:fs".*node: built-ins/);
    await assert.rejects(failing('cdn', { 'src/main.js': 'export * from "https://cdn.example/x.js";\n' }), /cannot bundle URL import "https:\/\/cdn\.example\/x\.js"/);
  });

  test('unresolved import, with an extension hint', async () => {
    await assert.rejects(failing('missing', { 'src/main.js': 'import { a } from "./nope.js";\n' }), /main\.js:1:1: unresolved import "\.\/nope\.js": .*nope\.js does not exist/);
    await assert.rejects(failing('noext', { 'src/main.js': 'import { a } from "./dep";\n', 'src/dep.js': 'export const a = 1;\n' }), /did you mean "\.\/dep\.js"\?/);
    await assert.rejects(failing('dynmissing', { 'src/main.js': 'const f = () => import("./later.js");\n' }), /main\.js:1:17: unresolved import "\.\/later\.js"/);
  });

  test('named import that the target does not export', async () => {
    await assert.rejects(
      failing('noexport', { 'src/main.js': 'import {\n  a,\n  Missing,\n} from "./dep.js";\n', 'src/dep.js': 'export const a = 1, missing = 2;\n' }),
      /main\.js:3:3: "\.\/dep\.js" \(.*dep\.js\) has no export named "Missing" \(did you mean "missing"\?\); it exports: a, missing/);
    await assert.rejects(failing('nodefault', { 'src/main.js': 'import d from "./dep.js";\n', 'src/dep.js': 'export const a = 1;\n' }), /has no export named "default"/);
    await assert.rejects(failing('reexportmissing', { 'src/main.js': 'export { zzz } from "./dep.js";\n', 'src/dep.js': 'export const a = 1;\n' }), /has no export named "zzz"/);
  });

  test('computed dynamic import without a usable pattern warns, or fails with --strict', async () => {
    const files = { 'src/main.js': 'const name = "./x.js";\nexport const p = () => import(name);\n' };
    const r = await build({ root: fixture('dynexpr', { 'index.html': page, ...files }), write: false });
    assert.ok(r.js.includes('__tb_dynamic("src", name)'), r.js.slice(-300));
    assert.ok(r.warnings.some((w) => /main\.js:2:24: computed dynamic import\(\)/.test(w)), r.warnings.join('\n'));
    await assert.rejects(build({ root: fixture('dynexpr2', { 'index.html': page, ...files }), write: false, strict: true }), /main\.js:2:24: computed dynamic import\(\): cannot tell/);
    await assert.rejects(failing('dynbare', { 'src/main.js': 'export const p = () => import("left-pad");\n' }), /bare module specifier "left-pad"/);
    const kept = await build({ root: fixture('dynbare2', { 'index.html': page, 'src/main.js': 'export const p = () => import("left-pad");\n' }), write: false, keepDynamic: true });
    assert.ok(kept.js.includes('import("left-pad")'));
  });

  test('top-level await is reported against the source file and line', async () => {
    await assert.rejects(failing('tla', { 'src/main.js': 'const a = 1;\n\nconst b = await Promise.resolve(a);\n' }),
      (e) => e instanceof BuildError && /src\/main\.js:3: SyntaxError/.test(e.message) && /top-level await is not supported/.test(e.message));
  });

  test('invalid JavaScript in a dependency is reported against that file', async () => {
    await assert.rejects(failing('syntax', { 'src/main.js': 'import "./dep.js";\n', 'src/dep.js': 'const a = 1;\nconst b = ;\n' }), /src\/dep\.js:2: SyntaxError/);
    await assert.rejects(failing('nested-import', { 'src/main.js': 'function f() {\n  import x from "./dep.js";\n}\n', 'src/dep.js': 'export default 1;\n' }), /src\/main\.js:2: SyntaxError/);
  });

  test('importing a test file, a missing page, a page without a module script', async () => {
    await assert.rejects(failing('testfile', { 'src/main.js': 'import "./a.test.js";\n', 'src/a.test.js': '\n' }), /is a test file/);
    await assert.rejects(build({ root: path.join(TMP, 'does-not-exist'), write: false }), /page not found: .*index\.html/);
    await assert.rejects(build({ root: fixture('nomodule', { 'index.html': '<!doctype html><p>hi</p>' }), write: false }), /no <script type="module"> found/);
  });

  test('reassigned exported let produces a warning for named importers', async () => {
    const r = await build({
      root: fixture('livelet', {
        'index.html': page,
        'src/main.js': 'import { n, bump } from "./dep.js";\nimport * as dep from "./dep.js";\nbump();\nwindow.__result = { snapshot: n, live: dep.n };\n',
        'src/dep.js': 'export let n = 0;\nexport function bump() { n += 1; }\n',
      }),
      write: false,
    });
    assert.ok(r.warnings.some((w) => /named import "n".*reassigned/.test(w)), r.warnings.join('\n'));
  });

  test('anything the built page would still fetch is reported as a warning', async () => {
    const r = await build({
      root: fixture('leftovers', {
        'index.html': '<!doctype html><title>t</title><link rel="stylesheet" href="https://fonts.example/x.css"><link rel="canonical" href="https://example.org/"><img src="missing.png"><img src="big.png"><script src="https://cdn.example/lib.js"></script><script type="module" src="src/main.js"></script>',
        'src/main.js': 'export const html = \'<img src="not-a-request.png">\';\n',
        'big.png': Buffer.alloc(4096, 1),
      }),
      write: false,
      assetLimit: 1024,
    });
    const w = r.warnings.join('\n');
    assert.match(w, /external <link> will be requested at run time: https:\/\/fonts\.example\/x\.css/);
    assert.match(w, /external script will be requested at run time: https:\/\/cdn\.example\/lib\.js/);
    assert.match(w, /<img> source not found: missing\.png/);
    assert.match(w, /asset larger than 1024 bytes is not inlined: .*big\.png/);
    assert.match(w, /the built page still requests big\.png \(<img>\)/);
    assert.ok(!/canonical|example\.org|not-a-request/.test(w), w);
  });

  test('command line: exit code 1 and a "build failed" message', () => {
    const dir = fixture('cli-fail', { 'index.html': page, 'src/main.js': 'import x from "left-pad";\n' });
    const r = spawnSync(process.execPath, [BUILD_CLI, '--root', dir, '--out', path.join(dir, 'dist', 'x.html')], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^build failed: .*main\.js:1:1: bare module specifier "left-pad"/);
    assert.ok(!fs.existsSync(path.join(dir, 'dist', 'x.html')));
    const bad = spawnSync(process.execPath, [BUILD_CLI, '--frobnicate'], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
  });
});

// ---------------------------------------------------------------------------------------------
// The two small tools that share this test file
// ---------------------------------------------------------------------------------------------

describe('check-headers', () => {
  test('recognises the header, with or without a shebang, and explains what is wrong', () => {
    assert.equal(headerProblem(`${HDR}const a = 1;\n`), null);
    assert.equal(headerProblem(`#!/usr/bin/env node\n${HDR}const a = 1;\n`), null);
    assert.equal(headerProblem(`﻿${HDR}`), null);
    assert.equal(headerProblem(HDR.replace(/\n/g, '\r\n')), null);
    assert.equal(headerProblem('const a = 1;\n'), 'header is missing');
    assert.equal(headerProblem(`\n${HDR}`), 'header is present but not at the top of the file');
    assert.equal(headerProblem(`${HEADER_LINES[0]}\n// something else\n`), 'second header line is missing or differs');
    assert.equal(headerProblem(''), 'header is missing');
  });

  test('--fix prepends the header after a shebang and leaves good files alone', () => {
    const dir = fixture('headers', {
      'web/good.js': `${HDR}export const a = 1;\n`,
      'web/bad.js': 'export const b = 2;\n',
      'tools/script.mjs': '#!/usr/bin/env node\nconsole.log(1);\n',
      'proxy/fn/index.ts': 'export const c: number = 3;\n',
      'proxy/node_modules/x/index.js': 'ignored\n',
      'web/notes.md': 'not checked\n',
      'web/page.html': '<!doctype html>\n',
    });
    const first = checkHeaders({ base: dir });
    assert.equal(first.checked, 4);
    assert.deepEqual(first.offenders.map((o) => o.file), ['proxy/fn/index.ts', 'tools/script.mjs', 'web/bad.js']);
    const fixed = checkHeaders({ base: dir, fix: true });
    assert.equal(fixed.offenders.length, 0);
    assert.equal(fixed.fixed.length, 3);
    assert.equal(fs.readFileSync(path.join(dir, 'tools/script.mjs'), 'utf8'), `#!/usr/bin/env node\n${HDR}console.log(1);\n`);
    assert.equal(fs.readFileSync(path.join(dir, 'web/bad.js'), 'utf8'), `${HDR}export const b = 2;\n`);
    assert.equal(fs.readFileSync(path.join(dir, 'web/good.js'), 'utf8'), `${HDR}export const a = 1;\n`);
    assert.equal(checkHeaders({ base: dir }).offenders.length, 0);
    assert.equal(withHeader(withHeader('x\n')), `${HDR}${HDR}x\n`); // withHeader itself is not idempotent; checkHeaders only calls it on offenders
  });

  test('command line exit codes', () => {
    const cli = path.join(HERE, 'check-headers.mjs');
    const dir = fixture('headers-cli', { 'a.js': 'let a;\n', 'b.js': `${HDR}let b;\n` });
    const bad = spawnSync(process.execPath, [cli, path.join(dir, 'a.js'), path.join(dir, 'b.js')], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /MISSING .*a\.js {2}\(header is missing\)\n2 files checked, 1 without the header/);
    const good = spawnSync(process.execPath, [cli, path.join(dir, 'b.js')], { encoding: 'utf8' });
    assert.equal(good.status, 0);
    const fix = spawnSync(process.execPath, [cli, '--fix', dir], { encoding: 'utf8' });
    assert.equal(fix.status, 0, fix.stdout);
    assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), `${HDR}let a;\n`);
  });

  test('every tooling file carries the header', () => {
    const r = checkHeaders({ targets: ['tools', 'test'] });
    assert.deepEqual(r.offenders, []);
    assert.ok(r.checked >= 6);
  });
});

describe('deploy-bundle', () => {
  const index = `${HDR}import { createHandler } from "./src/handler.js";\nimport type { Foo } from "./src/cache.js";\nDeno.serve(createHandler({}));\n`;
  const good = {
    'proxy/supabase/functions/spherex/index.ts': index,
    'proxy/src/handler.js': `${HDR}import { get } from './cache.js';\nexport { fogRead } from './fog.js';\nexport const createHandler = () => async () => new Response(get());\nconst lazy = () => import('./fits.js');\n`,
    'proxy/src/cache.js': `${HDR}export const get = () => 'x';\n`,
    'proxy/src/fog.js': `${HDR}export const fogRead = () => 1;\n`,
    'proxy/src/fits.js': `${HDR}export const parse = () => 1;\n`,
    'proxy/src/fits.test.js': `import test from 'node:test';\n`,
    'proxy/fixtures/synth.js': `${HDR}export const x = 1;\n`,
  };

  test('lists imports, also in TypeScript the analyser cannot parse', () => {
    assert.deepEqual(listImports(index, 'index.ts').map((i) => i.spec), ['./src/handler.js', './src/cache.js']);
    assert.deepEqual(listImports("// import x from 'nope'\nimport a from './a.js';\nconst b = await import('./b.js');\nimport(c);\n", 'x.js').map((i) => `${i.kind}:${i.spec}`),
      ['static:./a.js', 'dynamic:./b.js', 'computed:null']);
  });

  test('assembles index.ts plus proxy/src/*.js without tests', () => {
    const r = assembleEdge({ project: fixture('edge-good', good) });
    assert.equal(r.ready, true, r.errors.join('\n'));
    assert.deepEqual(r.files.map((f) => f.name), ['index.ts', 'src/cache.js', 'src/fits.js', 'src/fog.js', 'src/handler.js']);
    assert.equal(r.files[0].content, index);
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.unreachable, []);
    const extra = assembleEdge({ project: fixture('edge-extra', { ...good, 'proxy/src/unused.js': `${HDR}export const u = 1;\n` }) });
    assert.equal(extra.ready, true);
    assert.deepEqual(extra.unreachable, ['src/unused.js']);
  });

  test('rejects imports that leave the set, Node built-ins and a wrong index.ts', () => {
    const cases = [
      [{ 'proxy/src/cache.js': `${HDR}import fs from 'node:fs';\nexport const get = () => fs;\n` }, /proxy\/src\/cache\.js:3: imports the Node built-in "node:fs"/],
      [{ 'proxy/src/cache.js': `${HDR}import path from 'path';\nexport const get = () => path;\n` }, /imports the Node built-in "path"/],
      [{ 'proxy/src/cache.js': `${HDR}import { x } from '../fixtures/synth.js';\nexport const get = () => x;\n` }, /proxy\/src\/cache\.js:3: "\.\.\/fixtures\/synth\.js" is outside the upload set/],
      [{ 'proxy/src/cache.js': `${HDR}import { x } from './gone.js';\nexport const get = () => x;\n` }, /"\.\/gone\.js" does not exist/],
      [{ 'proxy/src/cache.js': `${HDR}import _ from 'lodash';\nexport const get = () => _;\n` }, /imports the bare package "lodash"/],
      [{ 'proxy/src/cache.js': `${HDR}import './fits.test.js';\nexport const get = () => 1;\n` }, /imports the test file/],
      [{ 'proxy/supabase/functions/spherex/index.ts': `${HDR}import { createHandler } from "../../../src/handler.js";\n` }, /index\.ts:3: index\.ts may import only from "\.\/src\/\.\.\."/],
      [{ 'proxy/supabase/functions/spherex/index.ts': `${HDR}import { createHandler } from "./src/nope.js";\n` }, /"\.\/src\/nope\.js" is not in the upload set/],
      [{ 'proxy/supabase/functions/spherex/index.ts': `${HDR}import { serve } from "https://deno.land/std/http/server.ts";\n` }, /may import only from "\.\/src\/\.\.\."/],
    ];
    cases.forEach(([override, pattern], i) => {
      const r = assembleEdge({ project: fixture(`edge-bad-${i}`, { ...good, ...override }) });
      assert.equal(r.ready, false);
      assert.ok(r.errors.some((e) => pattern.test(e)), `case ${i}: ${r.errors.join(' | ')}`);
    });
  });

  test('lazy imports that leave the set and Node globals are warnings', () => {
    const r = assembleEdge({ project: fixture('edge-warn', {
      ...good,
      'proxy/src/cache.js': `${HDR}export const get = () => import(new URL('../fixtures/synth.js', import.meta.url).href);\nexport const env = () => process.env.X;\nexport const safe = () => (typeof process !== 'undefined' ? 1 : 2);\n`,
    }) });
    assert.equal(r.ready, true, r.errors.join('\n'));
    assert.equal(r.warnings.length, 2, r.warnings.join('\n'));
    assert.match(r.warnings[0], /cache\.js:3: lazy import of "\.\.\/fixtures\/synth\.js", which is NOT in the upload set/);
    assert.match(r.warnings[1], /cache\.js:4: uses the Node global "process"/);
  });

  test('a function that does not exist yet is reported clearly (exit code 2), nothing is written', () => {
    const dir = fixture('edge-missing', { 'proxy/src/cache.js': `${HDR}export const get = () => 1;\n` });
    const r = assembleEdge({ project: dir });
    assert.equal(r.ready, false);
    assert.equal(r.exists, false);
    assert.match(r.errors[0], /index\.ts does not exist yet/);
    const cli = spawnSync(process.execPath, [path.join(HERE, 'deploy-bundle.mjs'), '--function', 'no-such-function', '--out', path.join(dir, 'out')], { encoding: 'utf8' });
    assert.equal(cli.status, 2);
    assert.match(cli.stdout, /NOT READY: the edge function entry point has not been written yet/);
    assert.ok(!fs.existsSync(path.join(dir, 'out')));
  });
});

// ---------------------------------------------------------------------------------------------
// The real page, whatever state it is in
// ---------------------------------------------------------------------------------------------

describe('the real web/ tree', () => {
  const webRoot = path.resolve(HERE, '..', 'web');
  const present = fs.existsSync(path.join(webRoot, 'index.html')) && fs.existsSync(path.join(webRoot, 'src', 'main.js'));

  test('export names computed by the bundler equal the module namespaces Node sees', { skip: present ? false : 'web/index.html or web/src/main.js is not there yet' }, async (t) => {
    let r;
    try {
      r = await build({ write: false });
    } catch (e) {
      if (e instanceof BuildError) { t.skip(`the page does not build right now: ${e.message.split('\n')[0]}`); return; }
      throw e;
    }
    let compared = 0;
    const notImportable = [];
    for (const m of r.meta.modules) {
      if (!m.id.endsWith('.js') || m.id.includes('#')) continue;
      let ns;
      try {
        ns = await import(pathToFileURL(path.join(webRoot, m.id)).href);
      } catch {
        notImportable.push(m.id); // needs a DOM at import time; nothing to compare against
        continue;
      }
      assert.deepEqual(m.exports, Object.keys(ns).sort(), `export list of ${m.id}`);
      compared++;
    }
    t.diagnostic(`${compared} modules compared, ${notImportable.length} not importable in Node${notImportable.length ? `: ${notImportable.join(', ')}` : ''}`);
    assert.ok(compared > 0);
  });
});
