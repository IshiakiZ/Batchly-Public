// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// test/e2e.mjs - end-to-end smoke suite (Playwright, headless Chromium, synthetic sky, no network).
//
//   node test/e2e.mjs                 start proxy/dev-server.mjs on a free port and test the page
//   node test/e2e.mjs --bundle        same checks against dist/tombaugh.html served by a throwaway
//                                     static server, API pointed at the dev server through ?api=
//   node test/e2e.mjs --url http://localhost:8787     use a server that is already running
//   node test/e2e.mjs --only canvas,spectrum          run only some steps (see --list)
//   options: --timeout <seconds> (movie load, default 90), --no-build (bundle mode: do not build
//            dist/tombaugh.html when it is missing or older than the sources), --list, --help
//
// Every step is reported on its own and a failure never aborts the rest. Screenshots go to
// docs/screens/e2e-<step>.png (e2e-bundle-<step>.png in bundle mode), the machine-readable report
// to dist/e2e-report.json (dist/e2e-bundle-report.json). Exit code 0 only if every step passed.
//
// Elements are located defensively: first the optional data-testid hooks listed in
// test/README.md, then an id of the same name, then role / aria-label / text heuristics.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  PROJECT, loadPlaywright, startDevServer, startStaticServer, createRunner, watchPage, firstVisible,
  sampleCanvases, pickViewerCanvas, overflowReport, textOf, sleep, waitFor,
} from './e2e-lib.mjs';

const FALLBACK = { ra: 269.4486, dec: 4.7652, fov: 4, det: 3 };
const STEPS = [
  ['load', 'page loads with no console errors or failed requests'],
  ['landing', 'landing screen shows and has a search box'],
  ['target', 'choosing a target leads to the movie view'],
  ['canvas', 'viewer canvas shows a picture (not blank)'],
  ['step', 'frame caption changes with the next-frame control and the right-arrow key'],
  ['play', 'play / pause works'],
  ['residual', 'switching the view to residual changes the picture'],
  ['spectrum', 'clicking the centre of the picture fills the spectrum panel'],
  ['url', 'URL carries ra/dec and survives a reload'],
  ['mobile', '390 x 844 viewport lays out without horizontal scroll'],
  ['embed', '?embed=1 hides the top bar'],
  ['simple', 'Simple mode is the default: plain answers, one switch to Advanced, fits a phone'],
  ['home', 'Simple mode starts on the whole sky: pick a star from the list, open it, come back'],
  ['sandbox', 'bundle runs inside a sandboxed iframe with an opaque origin (bundle mode only)'],
];

function parseArgs(argv) {
  const o = { bundle: false, url: null, only: null, timeout: 90, build: true, list: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--bundle') o.bundle = true;
    else if (a === '--url') o.url = value().replace(/\/+$/, '');
    else if (a === '--only') o.only = value();
    else if (a === '--timeout') o.timeout = Number(value());
    else if (a === '--no-build') o.build = false;
    else if (a === '--list') o.list = true;
    else if (a === '--headed') { /* accepted for habit; the suite always runs headless */ } else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (o.only) {
    const known = new Set(STEPS.map((s) => s[0]));
    for (const s of o.only.split(',')) if (!known.has(s.trim())) throw new Error(`unknown step "${s}" (known: ${[...known].join(', ')})`);
  }
  if (!Number.isFinite(o.timeout) || o.timeout <= 0) throw new Error('--timeout expects seconds');
  return o;
}

// ---------------------------------------------------------------------------------------------
// Locators: data-testid hook, then id, then heuristics
// ---------------------------------------------------------------------------------------------

const hook = (page, name) => [page.locator(`[data-testid="${name}"]`), page.locator(`[id="${name}"]`)];

const find = {
  landing: (page) => [...hook(page, 'landing'), page.locator('[class*="landing" i]')],
  search: (page) => [
    ...hook(page, 'search-input'),
    page.locator('[data-testid="landing"] input, #landing input, [class*="landing" i] input'),
    page.getByRole('searchbox'),
    page.locator('[role="search"] input:not([type=hidden])'),
    page.locator('input[type="search"]'),
    page.getByPlaceholder(/ra|dec|coord|name|star|search/i),
    page.locator('input[type="text"]'),
  ],
  targetCard: (page) => [
    ...hook(page, 'target-card'),
    page.locator('button[class*="card" i], a[class*="card" i], [role="button"][class*="card" i]'),
    page.locator('[class*="target" i] button, button[class*="target" i], a[class*="target" i]'),
    page.locator('[class*="chip" i]'),
  ],
  viewer: (page) => [...hook(page, 'viewer'), page.locator('[class*="viewer" i]')],
  player: (page) => page.locator('[data-testid="player"], #player, [class*="player" i], [role="group"][aria-label*="player" i]'),
  play: (page) => [
    ...hook(page, 'play'),
    find.player(page).getByRole('button', { name: /^\s*(play|pause)\b/i }),
    page.locator('button[class*="play" i]'),
    page.getByRole('button', { name: /^\s*(play|pause)\b(?!.*animation)/i }),
  ],
  next: (page) => [
    ...hook(page, 'next'),
    page.getByRole('button', { name: /next frame|step forward|^\s*next\b/i }),
    page.locator('button[title*="next" i], button[aria-label*="next" i]'),
  ],
  prev: (page) => [
    ...hook(page, 'prev'),
    page.getByRole('button', { name: /previous frame|step back|^\s*(prev|previous)\b/i }),
  ],
  residual: (page) => [
    ...hook(page, 'view-residual'),
    page.getByRole('radio', { name: /residual/i }),
    page.getByRole('tab', { name: /residual/i }),
    page.getByRole('button', { name: /residual/i }),
    page.locator('label').filter({ hasText: /residual/i }),
    page.locator('[data-view="residual"], [value="residual"]:not(option)'),
  ],
  passes: (page) => [
    ...hook(page, 'view-passes'),
    page.getByRole('radio', { name: /passes/i }),
    page.getByRole('tab', { name: /passes/i }),
    page.getByRole('button', { name: /passes/i }),
  ],
  spectrum: (page) => [
    ...hook(page, 'spectrum-panel'),
    page.locator('#panel-spectrum, #spectrum-body, #spectrum'),
    page.locator('[class*="spectrum" i]'),
  ],
  caption: (page) => [...hook(page, 'caption'), page.locator('[class~="caption"]'), page.locator('[class*="caption" i]')],
  topbar: (page) => [...hook(page, 'topbar'), page.locator('header'), page.locator('[role="banner"]'), page.locator('[class*="topbar" i], [class*="top-bar" i]')],
};

const SPECTRUM_SELECTORS = '[data-testid="spectrum-panel"], [id="spectrum-panel"], #panel-spectrum, #spectrum-body, #spectrum, [class*="spectrum" i]';

/** Largest number of plotted points in a visible SVG (inside the spectrum panel if one is found). */
function countSvgPoints(page) {
  return page.evaluate((selectors) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width >= 100 && r.height >= 60 && s.visibility !== 'hidden' && s.display !== 'none' && el.getClientRects().length > 0;
    };
    const count = (svg) => {
      const marks = svg.querySelectorAll('circle, ellipse, rect[class*="point" i], path[class*="point" i], use').length;
      let line = 0;
      for (const p of svg.querySelectorAll('path, polyline')) {
        const d = p.getAttribute('d') || '';
        const pts = p.getAttribute('points') || '';
        line = Math.max(line, (d.match(/[ML]/gi) || []).length, pts.trim() ? pts.trim().split(/\s+/).length : 0);
      }
      return Math.max(marks, line);
    };
    const panels = Array.from(document.querySelectorAll(selectors)).filter((p) => p.getClientRects().length > 0);
    const scope = panels.length ? panels : [document.body];
    let best = 0;
    let svgs = 0;
    for (const root of scope) {
      const list = root.tagName.toLowerCase() === 'svg' ? [root] : Array.from(root.querySelectorAll('svg'));
      for (const svg of list) {
        if (!visible(svg)) continue;
        svgs++;
        best = Math.max(best, count(svg));
      }
    }
    return { points: best, svgs, scoped: panels.length > 0 };
  }, SPECTRUM_SELECTORS);
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(3, 20).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  if (opts.list) {
    for (const [name, title] of STEPS) console.log(`${name.padEnd(10)} ${title}`);
    return 0;
  }

  const mode = opts.bundle ? 'bundle' : 'dev';
  const prefix = opts.bundle ? 'e2e-bundle-' : 'e2e-';
  const screens = path.join(PROJECT, 'docs', 'screens');
  const reportFile = path.join(PROJECT, 'dist', opts.bundle ? 'e2e-bundle-report.json' : 'e2e-report.json');
  const movieTimeout = opts.timeout * 1000;
  const startedAt = new Date();
  const setup = { mode, notes: [] };
  const cleanup = [];
  const onSignal = () => {
    Promise.allSettled(cleanup.reverse().map((fn) => fn())).finally(() => process.exit(130));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  let fatal = null;
  let browser = null;
  let runner = null;
  const pages = [];
  const allEvents = [];

  const writeReport = () => {
    const results = runner ? runner.results : [];
    const summary = runner ? runner.summary() : { passed: 0, failed: 0, skipped: 0, total: 0 };
    const report = {
      tool: 'test/e2e.mjs', mode, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(), ok: !fatal && summary.failed === 0 && summary.passed > 0,
      fatal, setup, summary, steps: results, events: allEvents.slice(0, 400),
    };
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    return report;
  };

  try {
    // ---- servers -------------------------------------------------------------------------------
    let serverUrl = opts.url;
    if (!serverUrl) {
      const dev = await startDevServer({ env: { TOMBAUGH_QUIET: '1' } });
      cleanup.push(() => dev.stop());
      serverUrl = dev.url;
      setup.devServer = dev.url;
      if (dev.note) setup.notes.push(dev.note);
    } else setup.devServer = `${serverUrl} (already running)`;

    let pageBase = `${serverUrl}/`;
    let extraQuery = '';
    let staticServer = null;
    if (opts.bundle) {
      const bundleFile = path.join(PROJECT, 'dist', 'tombaugh.html');
      const newestSource = () => {
        let newest = 0;
        const walk = (d) => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p); else newest = Math.max(newest, fs.statSync(p).mtimeMs);
          }
        };
        walk(path.join(PROJECT, 'web'));
        return newest;
      };
      const stale = !fs.existsSync(bundleFile) || fs.statSync(bundleFile).mtimeMs < newestSource();
      if (stale && opts.build) {
        const r = spawnSync(process.execPath, [path.join(PROJECT, 'tools', 'build.mjs')], { cwd: PROJECT, encoding: 'utf8' });
        setup.build = (r.stdout + r.stderr).trim().split('\n').slice(-6).join('\n');
        if (r.status !== 0) throw new Error(`node tools/build.mjs failed:\n${setup.build}`);
      } else if (stale) setup.notes.push('dist/tombaugh.html is missing or older than web/ (--no-build)');
      if (!fs.existsSync(bundleFile)) throw new Error('dist/tombaugh.html does not exist; run node tools/build.mjs');
      const api = `${serverUrl}/api`;
      staticServer = await startStaticServer(path.join(PROJECT, 'dist'), {
        index: 'tombaugh.html',
        routes: {
          '/frame.html': (req, res, url) => {
            const inner = `/tombaugh.html?${url.searchParams.toString()}`;
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(`<!doctype html><meta charset="utf-8"><title>sandbox host</title><style>html,body{margin:0;height:100%;background:#333}iframe{border:0;width:100%;height:100%}</style><iframe id="app" sandbox="allow-scripts" src="${inner.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`);
          },
        },
      });
      cleanup.push(() => staticServer.close());
      pageBase = `${staticServer.url}/tombaugh.html`;
      extraQuery = `api=${encodeURIComponent(api)}`;
      setup.bundle = { file: 'dist/tombaugh.html', bytes: fs.statSync(bundleFile).size, servedAt: pageBase, api };
    }
    // The steps written for the full console ask for Advanced mode; the 'simple' step passes
    // mode = null to get the page as a first-time visitor does.
    const pageUrl = (params = {}, mode = 'advanced') => {
      const all = mode && !('mode' in params) ? { ...params, mode } : params;
      const q = [extraQuery, new URLSearchParams(Object.entries(all).map(([k, v]) => [k, String(v)])).toString()].filter(Boolean).join('&');
      return q ? `${pageBase}?${q}` : pageBase;
    };
    setup.page = pageUrl();

    // Bundle mode: the single file may talk to the API and to nothing else.
    const foreign = [];
    const trackForeign = (pg) => {
      if (!opts.bundle) return;
      pg.on('request', (r) => {
        const u = r.url();
        if (/^(data|blob|about):/.test(u)) return;
        // The sky start page shows picture tiles straight from IRSA (images only, no data sent).
        if (u.startsWith('https://irsa.ipac.caltech.edu/data/hips/')) return;
        if (u.startsWith(`${serverUrl}/api/`) || u.startsWith(`${serverUrl}/api?`)) return;
        if (u.startsWith(`${staticServer.url}/tombaugh.html`) || u.startsWith(`${staticServer.url}/frame.html`)) return;
        if (!foreign.includes(u)) foreign.push(u);
      });
    };

    // ---- browser -------------------------------------------------------------------------------
    const { chromium } = await loadPlaywright();
    browser = await chromium.launch();
    cleanup.push(() => browser.close());
    setup.browser = `chromium ${browser.version()}`;
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await desktop.newPage();
    const watch = watchPage(page);
    pages.push({ name: 'desktop', watch });
    trackForeign(page);

    // API requests in flight, to know when loading has settled.
    const pending = new Set();
    let lastApiActivity = Date.now();
    const isApi = (u) => /\/(api|spherex)\/|\/(search|cutout|gaia|resolve|health|fog)\b/.test(u);
    page.on('request', (r) => { if (isApi(r.url())) { pending.add(r); lastApiActivity = Date.now(); } });
    const done = (r) => { if (pending.delete(r)) lastApiActivity = Date.now(); };
    page.on('requestfinished', done);
    page.on('requestfailed', done);
    const waitQuiet = async (quietMs = 1200, timeoutMs = movieTimeout) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        if (pending.size === 0 && Date.now() - lastApiActivity >= quietMs) return true;
        await sleep(100);
      }
      return false;
    };

    fs.mkdirSync(screens, { recursive: true });
    let ownShot = false; // set by steps that photograph another page themselves
    let currentStepMark = 0;
    runner = createRunner({
      only: opts.only,
      onStepEnd: async (rec) => {
        if (rec.status === 'skipped') return;
        const errs = watch.since(currentStepMark);
        if (errs.length) rec.data.pageErrors = errs.slice(0, 10).map((e) => `${e.kind}: ${e.text.split('\n')[0]}`);
        const file = path.join(screens, `${prefix}${rec.name}.png`);
        const relFile = path.relative(PROJECT, file).split(path.sep).join('/');
        if (ownShot) {
          ownShot = false;
          if (fs.existsSync(file)) rec.screenshot = relFile;
          return;
        }
        try {
          await page.screenshot({ path: file, fullPage: false, timeout: 15000 });
          rec.screenshot = relFile;
        } catch (e) { rec.notes.push(`screenshot failed: ${String(e.message).split('\n')[0]}`); }
      },
    });
    const step = (name, fn) => {
      const title = STEPS.find((s) => s[0] === name)[1];
      return runner.step(name, title, async (t) => { currentStepMark = watch.mark(); ownShot = false; await fn(t); });
    };

    // ---- shared state helpers ------------------------------------------------------------------
    const viewerSample = async (target = page) => pickViewerCanvas(await sampleCanvases(target));
    const landingVisible = async () => !!(await firstVisible(find.landing(page)));
    let movieProblem = null;
    let target = null; // { ra, dec } of the movie on the desktop page, when known

    /** Wait until the viewer canvas shows a picture. Returns the canvas sample. */
    const waitForMovie = async (target_ = page, timeoutMs = movieTimeout) => {
      let lastSample = null;
      try {
        return await waitFor(async () => {
          lastSample = await viewerSample(target_);
          return lastSample && lastSample.distinct > 8 ? lastSample : null;
        }, { timeoutMs, intervalMs: 250, what: 'a non-blank canvas in the viewer' });
      } catch (e) {
        const status = await textOf(await firstVisible([page.locator('[role="alert"], [class*="error" i], [class*="status" i]')]));
        throw new Error(`${e.message}; canvas: ${lastSample ? `${lastSample.width}x${lastSample.height}, ${lastSample.distinct} distinct sampled colours` : 'none found'}${status ? `; page says: "${status.slice(0, 160)}"` : ''}`);
      }
    };
    /** Make sure the desktop page shows a movie; navigate to the fallback target if it does not. */
    const ensureMovie = async (t) => {
      if (movieProblem) throw new Error(`no movie on screen (${movieProblem})`);
      const now = await viewerSample();
      if (now && now.distinct > 8 && !(await landingVisible())) return now;
      const url = new URL(page.url() === 'about:blank' ? pageUrl() : page.url());
      if (!url.searchParams.has('ra')) {
        await page.goto(pageUrl(FALLBACK), { waitUntil: 'load' });
        target = { ra: FALLBACK.ra, dec: FALLBACK.dec };
        if (t) t.note(`opened ${pageUrl(FALLBACK)}`);
      }
      try {
        const s = await waitForMovie();
        await waitQuiet();
        return s;
      } catch (e) {
        movieProblem = e.message.split('\n')[0];
        throw e;
      }
    };
    const captionLocator = () => firstVisible(find.caption(page));
    const signature = async () => {
      const cap = await textOf(await captionLocator());
      const s = await viewerSample();
      let tParam = null;
      try { tParam = new URL(page.url()).searchParams.get('t'); } catch { /* opaque URL */ }
      return { caption: cap, hash: s ? s.hash : null, t: tParam };
    };
    const sigChanged = (a, b) => (a.caption !== null && b.caption !== null ? a.caption !== b.caption : a.hash !== b.hash || a.t !== b.t);
    /** true if the picture changes by itself within `ms`. */
    const isPlaying = async (ms = 2600) => {
      const first = await signature();
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        await sleep(200);
        if (sigChanged(first, await signature())) return true;
      }
      return false;
    };
    const blurActive = () => page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
    const ensurePaused = async (t) => {
      if (!(await isPlaying(1800))) return true;
      const btn = await firstVisible(find.play(page));
      if (btn) await btn.click(); else { await blurActive(); await page.keyboard.press('Space'); }
      const stillPlaying = await isPlaying(1800);
      if (stillPlaying && t) t.note('the movie could not be paused');
      return !stillPlaying;
    };

    // ---- steps ---------------------------------------------------------------------------------
    await step('load', async (t) => {
      const res = await page.goto(pageUrl(), { waitUntil: 'load' });
      if (!res || res.status() >= 400) throw new Error(`GET ${pageUrl()} answered ${res ? res.status() : 'nothing'}`);
      await waitQuiet(800, 15000);
      await sleep(500);
      const bad = watch.since(0);
      t.data('title', await page.title());
      t.data('requests', watch.events.filter((e) => e.kind === 'request.aborted').length ? 'some requests were aborted' : 'none aborted');
      const warnings = watch.events.filter((e) => e.kind === 'console.warning');
      for (const w of [...new Set(warnings.map((x) => x.text.split('\n')[0]))].slice(0, 6)) t.note(`console warning: ${w.slice(0, 220)}`);
      if (bad.length) throw new Error(`${bad.length} problem(s) while loading:\n${bad.slice(0, 8).map((e) => `- ${e.kind}: ${e.text}`).join('\n')}`);
      if (foreign.length) throw new Error(`the single-file page requested something other than itself and the API:\n${foreign.slice(0, 8).map((u) => `- ${u}`).join('\n')}`);
    });

    await step('landing', async (t) => {
      if (new URL(page.url()).searchParams.has('ra') || page.url() === 'about:blank') await page.goto(pageUrl(), { waitUntil: 'load' });
      const landing = await firstVisible(find.landing(page), { timeoutMs: 8000 });
      if (!landing) {
        const wordmark = await firstVisible([page.getByText(/tombaugh/i)], { timeoutMs: 1000 });
        if (!wordmark) throw new Error('no landing screen: nothing matched [data-testid="landing"], #landing or a "landing" class, and the word "Tombaugh" is not visible');
        t.note('no landing container found (hook: data-testid="landing"); the wordmark is visible, continuing');
      }
      const box = await firstVisible(find.search(page), { timeoutMs: 4000 });
      if (!box) throw new Error('no visible search box (hook: data-testid="search-input")');
      if (!(await box.isEditable())) throw new Error('the search box is not editable');
      t.data('searchPlaceholder', await box.getAttribute('placeholder'));
      const cards = await page.locator('[data-testid="target-card"]').count();
      t.data('targetCardsWithTestid', cards);
      const text = (await textOf(landing || page.locator('body'))) || '';
      if (!/tombaugh/i.test(text)) t.note('the landing text does not contain the wordmark "Tombaugh"');
    });

    await step('target', async (t) => {
      if (new URL(page.url()).searchParams.has('ra') || page.url() === 'about:blank') await page.goto(pageUrl(), { waitUntil: 'load' });
      const card = await firstVisible(find.targetCard(page), { timeoutMs: 6000 });
      let clicked = false;
      let clickError = null;
      if (card) {
        t.data('card', ((await textOf(card)) || '').slice(0, 80));
        try {
          await card.click({ timeout: 5000 });
          clicked = true;
          await waitFor(async () => {
            const s = await viewerSample();
            return new URL(page.url()).searchParams.has('ra') || (s && s.distinct > 8 && !(await landingVisible()));
          }, { timeoutMs: 15000, what: 'the movie view after clicking the first target card' });
        } catch (e) { clickError = e.message.split('\n')[0]; }
      } else t.note('no target card or chip found (hook: data-testid="target-card"); used the URL fallback');
      if (!card || clickError) {
        await page.goto(pageUrl(FALLBACK), { waitUntil: 'load' });
        target = { ra: FALLBACK.ra, dec: FALLBACK.dec };
      }
      const viewer = await firstVisible(find.viewer(page), { timeoutMs: 10000 });
      if (!viewer) throw new Error(`${clickError ? `clicking the first target card did not work (${clickError}); after the URL fallback ` : ''}no viewer is visible (hook: data-testid="viewer")`);
      if (await landingVisible()) throw new Error('the landing screen is still visible after choosing a target');
      const u = new URL(page.url());
      t.data('url', u.pathname + u.search);
      if (clicked && !clickError) {
        const ra = Number(u.searchParams.get('ra'));
        const dec = Number(u.searchParams.get('dec'));
        if (u.searchParams.has('ra') && Number.isFinite(ra) && Number.isFinite(dec)) target = { ra, dec };
      }
      if (clickError) throw new Error(`clicking the first target card did not lead to a movie (${clickError}); the URL fallback did open the viewer`);
    });

    await step('canvas', async (t) => {
      const s = await ensureMovie(t);
      t.data('canvas', { width: s.width, height: s.height, distinctSampledColours: s.distinct, insideViewerHook: s.inViewer });
      if (!s.inViewer) t.note('picked the largest visible canvas; no canvas sits inside [data-testid="viewer"] / #viewer');
      if (s.distinct <= 8) throw new Error(`canvas looks blank: only ${s.distinct} distinct colours in ${s.width}x${s.height}`);
      const quiet = await waitQuiet();
      if (!quiet) t.note('API requests were still in flight when the step ended');
    });

    await step('step', async (t) => {
      await ensureMovie(t);
      await ensurePaused(t);
      if (!(await captionLocator())) t.note('no caption element found (hook: data-testid="caption"); comparing the canvas and the t parameter instead');
      const outcomes = {};
      const before = await signature();
      t.data('captionBefore', before.caption);
      const next = await firstVisible(find.next(page));
      if (next) {
        await next.click();
        try {
          await waitFor(async () => sigChanged(before, await signature()), { timeoutMs: 4000, what: 'the caption to change after the next-frame control' });
          outcomes.control = true;
        } catch (e) { outcomes.control = false; }
      } else { outcomes.control = null; t.note('no next-frame control found (hook: data-testid="next")'); }
      const mid = await signature();
      await blurActive();
      await page.keyboard.press('ArrowRight');
      try {
        await waitFor(async () => sigChanged(mid, await signature()), { timeoutMs: 4000, what: 'the caption to change after ArrowRight' });
        outcomes.arrowKey = true;
      } catch (e) { outcomes.arrowKey = false; }
      const after = await signature();
      t.data('captionAfter', after.caption);
      t.data('outcomes', outcomes);
      const prev = await firstVisible(find.prev(page));
      if (prev) {
        await prev.click();
        await sleep(400);
        t.data('captionAfterPrevious', (await signature()).caption);
      }
      if (!outcomes.control && !outcomes.arrowKey) throw new Error(`the frame caption did not change: next-frame control ${outcomes.control === null ? 'not found' : 'had no effect'}, ArrowRight had no effect (caption stays "${before.caption}")`);
      if (outcomes.control === false) throw new Error('the next-frame control did not change the caption (the ArrowRight key did)');
      if (outcomes.arrowKey === false) throw new Error('the ArrowRight key did not change the caption (the next-frame control did)');
    });

    await step('play', async (t) => {
      await ensureMovie(t);
      const btn = await firstVisible(find.play(page));
      if (!btn) t.note('no play/pause control found (hook: data-testid="play"); using the space key');
      const toggle = async () => { if (btn) await btn.click(); else { await blurActive(); await page.keyboard.press('Space'); } };
      const label = async () => (btn ? `${(await btn.getAttribute('aria-label')) || (await textOf(btn)) || ''}|${(await btn.getAttribute('aria-pressed')) || ''}` : null);
      const state0 = await isPlaying();
      const label0 = await label();
      await toggle();
      const state1 = await isPlaying();
      const label1 = await label();
      await toggle();
      const state2 = await isPlaying();
      t.data('playing', { initially: state0, afterFirstToggle: state1, afterSecondToggle: state2 });
      t.data('controlLabel', { initially: label0, afterFirstToggle: label1 });
      if (state1 === state0) throw new Error(`toggling play/pause did not change the playback state (it stayed ${state0 ? 'playing' : 'paused'})`);
      if (state2 !== state0) throw new Error(`the second toggle did not return to the ${state0 ? 'playing' : 'paused'} state`);
      if (btn && label0 === label1) t.note('the control label / aria-pressed did not change with the state');
      if (state2) await toggle(); // leave it paused for the next steps
    });

    await step('residual', async (t) => {
      await ensureMovie(t);
      const paused = await ensurePaused(t);
      if (!paused) throw new Error('could not pause the movie, so a change of the picture cannot be attributed to the view switch');
      const before = await signature();
      const control = await firstVisible(find.residual(page));
      let how = null;
      if (control) { await control.click(); how = 'control'; } else {
        const select = page.locator('select').filter({ has: page.locator('option', { hasText: /residual/i }) }).first();
        if (await select.count()) { await select.selectOption({ label: await select.locator('option', { hasText: /residual/i }).first().innerText() }); how = 'select'; } else {
          t.note('no residual control found (hook: data-testid="view-residual"); pressing "r"');
          await blurActive();
          await page.keyboard.press('r');
          how = 'key r';
        }
      }
      t.data('switchedWith', how);
      await waitFor(async () => { const s = await signature(); return s.hash !== null && s.hash !== before.hash; }, { timeoutMs: Math.min(movieTimeout, 45000), intervalMs: 250, what: 'the canvas content to change after switching to the residual view' });
      await waitQuiet(800, 30000);
      const after = await viewerSample();
      t.data('canvasAfter', { distinctSampledColours: after ? after.distinct : 0 });
      let view = null;
      const readView = () => { try { return new URL(page.url()).searchParams.get('view'); } catch { return null; } };
      await waitFor(() => readView() === 'residual', { timeoutMs: 3000, what: 'view=residual in the URL' }).catch(() => {});
      view = readView();
      t.data('urlView', view);
      if (view !== 'residual') t.note(`the URL says view=${view}, expected view=residual`);
      if (!after || after.distinct <= 8) throw new Error('the residual view is blank');
    });

    await step('spectrum', async (t) => {
      const s = await ensureMovie(t);
      const before = await countSvgPoints(page);
      const tab = await firstVisible([page.getByRole('tab', { name: /spectrum/i })]);
      if (tab && (await tab.getAttribute('aria-selected')) === 'false') await tab.click();
      await page.mouse.click(s.cx, s.cy);
      t.data('clickedAt', [s.cx, s.cy]);
      t.data('pointsBefore', before.points);
      let after = before;
      await waitFor(async () => { after = await countSvgPoints(page); return after.points >= 3 && (before.points < 3 || after.points > 0); }, { timeoutMs: 20000, intervalMs: 250, what: 'an SVG with at least 3 plotted points in the spectrum panel' })
        .catch((e) => { throw new Error(`${e.message}; found ${after.svgs} visible svg(s) with at most ${after.points} point(s)${after.scoped ? '' : ' (no spectrum panel found, hook: data-testid="spectrum-panel")'}`); });
      t.data('pointsAfter', after.points);
      if (!after.scoped) t.note('no spectrum panel found (hook: data-testid="spectrum-panel"); counted points in any large SVG');
      if (before.points >= 3) t.note('the spectrum panel already had points before the click');
    });

    await step('url', async (t) => {
      await ensureMovie(t);
      const before = new URL(page.url());
      const ra = Number(before.searchParams.get('ra'));
      const dec = Number(before.searchParams.get('dec'));
      t.data('urlBefore', before.pathname + before.search);
      if (!before.searchParams.has('ra') || !before.searchParams.has('dec') || !Number.isFinite(ra) || !Number.isFinite(dec)) throw new Error(`the URL does not carry ra and dec: ${before.search || '(no query)'}`);
      if (target && (Math.abs(ra - target.ra) > 0.5 || Math.abs(dec - target.dec) > 0.5)) throw new Error(`the URL says ra=${ra} dec=${dec}, the target is ra=${target.ra} dec=${target.dec}`);
      if (opts.bundle && !before.searchParams.has('api')) t.note('the page dropped the api= parameter from the URL; a reload falls back to the default API base');
      await page.reload({ waitUntil: 'load' });
      const s = await waitForMovie().catch((e) => { throw new Error(`after reload: ${e.message}`); });
      const after = new URL(page.url());
      t.data('urlAfter', after.pathname + after.search);
      t.data('canvasAfterReload', { distinctSampledColours: s.distinct });
      if (Math.abs(Number(after.searchParams.get('ra')) - ra) > 1e-6 || Math.abs(Number(after.searchParams.get('dec')) - dec) > 1e-6) throw new Error(`ra/dec changed across the reload: ${before.search} -> ${after.search}`);
      for (const k of ['fov', 'det', 'view']) {
        if (before.searchParams.get(k) !== after.searchParams.get(k)) t.note(`${k} changed across the reload: ${before.searchParams.get(k)} -> ${after.searchParams.get(k)}`);
      }
      await waitQuiet();
    });

    await step('mobile', async (t) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      ownShot = true;
      try {
        const m = await ctx.newPage();
        trackForeign(m);
        const mw = watchPage(m);
        pages.push({ name: 'mobile', watch: mw });
        const problems = [];
        await m.goto(pageUrl(), { waitUntil: 'load' });
        await sleep(1200);
        const landing = await overflowReport(m, 390);
        t.data('landing', landing);
        await m.screenshot({ path: path.join(screens, `${prefix}mobile-landing.png`) }).catch(() => {});
        const describe = (r) => `content is ${Math.max(r.scrollWidth, r.innerWidth)}px wide on a 390px screen, so the page scrolls sideways or is zoomed out (sticking out: ${r.offenders.map((o) => `${o.el} x ${o.left}..${o.right}`).slice(0, 4).join('; ') || 'unknown'})`;
        if (landing.overflow) problems.push(`landing: ${describe(landing)}`);
        await m.goto(pageUrl(FALLBACK), { waitUntil: 'load' });
        let loaded = true;
        try { await waitForMovie(m, Math.min(movieTimeout, 60000)); } catch (e) { loaded = false; problems.push(`viewer: ${e.message.split('\n')[0]}`); }
        await sleep(800);
        const viewer = await overflowReport(m, 390);
        t.data('viewer', viewer);
        if (viewer.overflow) problems.push(`viewer: ${describe(viewer)}`);
        if (loaded) {
          const c = pickViewerCanvas(await sampleCanvases(m));
          const box = await m.evaluate((i) => { const r = document.querySelectorAll('canvas')[i].getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; }, c.index);
          t.data('canvasBox', box);
          if (box.left < -1 || box.right > 391) problems.push(`viewer canvas sticks out of the viewport (x from ${box.left} to ${box.right})`);
          if (box.width < 200) t.note(`the viewer canvas is only ${box.width}px wide on a phone`);
        }
        const clipped = await m.evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll('button, select, input, a[href], [role="button"], [role="radio"], [role="tab"]')) {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || st.display === 'none' || el.getClientRects().length === 0) continue;
            if (r.top > innerHeight * 3 || r.bottom < 0) continue;
            if (r.right <= 391 && r.left >= -1) continue;
            let scrollable = false;
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
              const ox = getComputedStyle(a).overflowX;
              if ((ox === 'auto' || ox === 'scroll') && a.scrollWidth > a.clientWidth + 1) { scrollable = true; break; }
            }
            const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40);
            out.push({ label, tag: el.tagName.toLowerCase(), left: Math.round(r.left), right: Math.round(r.right), reachableByScrollingItsRow: scrollable });
          }
          return out;
        });
        t.data('controlsOutsideViewport', clipped);
        const lost = clipped.filter((c) => !c.reachableByScrollingItsRow);
        if (lost.length) t.note(`${lost.length} control(s) are cut off at the viewport edge and cannot be scrolled into view: ${lost.slice(0, 5).map((c) => `"${c.label}" (${c.tag}, x ${c.left}..${c.right})`).join(', ')}`);
        const errs = mw.since(0);
        if (errs.length) t.data('pageErrors', errs.slice(0, 6).map((e) => `${e.kind}: ${e.text.split('\n')[0]}`));
        t.data('screenshots', [`docs/screens/${prefix}mobile-landing.png`, `docs/screens/${prefix}mobile.png`]);
        allEvents.push(...mw.events.map((e) => ({ page: 'mobile', ...e })));
        if (problems.length) throw new Error(problems.join('\n'));
      } finally {
        const m = ctx.pages()[0];
        if (m) await m.screenshot({ path: path.join(screens, `${prefix}mobile.png`) }).catch(() => {});
        await ctx.close();
      }
    });

    await step('embed', async (t) => {
      await ensureMovie(t);
      const normalBar = await firstVisible(find.topbar(page));
      if (!normalBar) throw new Error('cannot find a top bar in the normal view (hook: data-testid="topbar"), so "hidden in embed mode" cannot be checked');
      const barBox = await normalBar.boundingBox();
      t.data('normalTopBar', barBox ? { height: Math.round(barBox.height), y: Math.round(barBox.y) } : null);
      const e = await desktop.newPage();
      trackForeign(e);
      const ew = watchPage(e);
      pages.push({ name: 'embed', watch: ew });
      ownShot = true;
      try {
        await e.goto(pageUrl({ ...FALLBACK, embed: 1 }), { waitUntil: 'load' });
        let loaded = true;
        try { await waitForMovie(e, Math.min(movieTimeout, 60000)); } catch (err) { loaded = false; t.note(`embed view: ${err.message.split('\n')[0]}`); }
        const bar = await firstVisible(find.topbar(e), { timeoutMs: 500 });
        const viewerTop = await e.evaluate(() => { const c = document.querySelector('[data-testid="viewer"], #viewer, [class*="viewer" i]'); return c ? Math.round(c.getBoundingClientRect().top) : null; });
        t.data('embedViewerTop', viewerTop);
        const errs = ew.since(0);
        if (errs.length) t.data('pageErrors', errs.slice(0, 6).map((x) => `${x.kind}: ${x.text.split('\n')[0]}`));
        allEvents.push(...ew.events.map((x) => ({ page: 'embed', ...x })));
        if (bar) {
          const box = await bar.boundingBox();
          throw new Error(`the top bar is still visible with ?embed=1 (${box ? `${Math.round(box.width)}x${Math.round(box.height)} at y=${Math.round(box.y)}` : 'visible'})`);
        }
        if (!loaded) throw new Error('the top bar is hidden, but the embedded view did not show a picture');
      } finally {
        await e.screenshot({ path: path.join(screens, `${prefix}embed.png`) }).catch(() => {});
        await e.close();
      }
    });

    await step('simple', async (t) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      ownShot = true;
      try {
        const p = await ctx.newPage();
        trackForeign(p);
        const pw = watchPage(p);
        pages.push({ name: 'simple', watch: pw });
        await p.goto(pageUrl(FALLBACK, null), { waitUntil: 'load' });
        await p.waitForFunction(() => document.documentElement.dataset.screen === 'console', null, { timeout: 15000 });
        const mode = await p.evaluate(() => document.documentElement.dataset.mode);
        t.data('modeOnFirstVisit', mode);
        if (mode !== 'simple') throw new Error(`a first visit opened in "${mode}" mode, not simple`);
        const shown = () => p.evaluate(() => {
          const on = (id) => { const el = document.getElementById(id); return !!el && el.getClientRects().length > 0; };
          return { modebar: on('modebar'), controls: on('controls'), tabs: on('tabs'), panels: on('panels'), toolstrip: on('toolstrip'), fieldsum: on('fieldsum'), simplebar: on('simplebar'), simple: on('simple'), player: on('player'), viewer: on('viewer') };
        });
        const first = await shown();
        t.data('visibleInSimple', first);
        const leaked = ['modebar', 'controls', 'tabs', 'panels', 'toolstrip', 'fieldsum'].filter((k) => first[k]);
        if (leaked.length) throw new Error(`Advanced-only parts are visible in Simple mode: ${leaked.join(', ')}`);
        const missing = ['simplebar', 'simple', 'player', 'viewer'].filter((k) => !first[k]);
        if (missing.length) throw new Error(`Simple mode is missing: ${missing.join(', ')}`);
        await waitForMovie(p, movieTimeout);
        // The change search lists what it found in plain words; clicking one answers two questions.
        await p.waitForSelector('.simple-change', { timeout: Math.min(movieTimeout, 60000) });
        const changes = await p.locator('.simple-change .simple-change-title').allInnerTexts();
        t.data('changes', changes);
        await p.locator('.simple-change').first().click();
        await p.waitForFunction(() => document.querySelectorAll('#simple .simple-row .simple-answer').length >= 2, null, { timeout: 20000 });
        const answers = await p.locator('#simple .simple-row').allInnerTexts();
        t.data('answers', answers.map((a) => a.replace(/\s+/g, ' ').slice(0, 160)));
        await waitFor(() => new URL(p.url()).searchParams.get('view') === 'residual', { timeoutMs: 5000, what: 'view=residual in the URL after picking a change' });
        const pressed = await p.evaluate(() => { const b = document.querySelector('#simplebar [data-view="residual"]'); return b ? b.getAttribute('aria-checked') : null; });
        if (pressed !== 'true') throw new Error('the "What changed" switch is not marked as selected in the residual view');
        await p.locator('#simplebar [data-view="passes"]').click();
        await waitFor(() => new URL(p.url()).searchParams.get('view') !== 'residual', { timeoutMs: 5000, what: 'the view to return to "The sky"' });
        // One switch to Advanced and back.
        await p.locator('#btn-mode').click();
        await p.waitForFunction(() => document.documentElement.dataset.mode === 'advanced', null, { timeout: 5000 });
        const adv = await shown();
        t.data('visibleInAdvanced', adv);
        const lost = ['modebar', 'controls', 'panels', 'player', 'viewer'].filter((k) => !adv[k]);
        if (lost.length) throw new Error(`Advanced mode is missing: ${lost.join(', ')}`);
        if (adv.simple || adv.simplebar) throw new Error('the Simple-mode blocks are still visible in Advanced mode');
        await waitFor(() => new URL(p.url()).searchParams.get('mode') === 'advanced', { timeoutMs: 5000, what: 'mode=advanced in the URL' });
        await p.locator('#btn-mode').click();
        await p.waitForFunction(() => document.documentElement.dataset.mode === 'simple', null, { timeout: 5000 });
        await waitFor(() => !new URL(p.url()).searchParams.has('mode'), { timeoutMs: 5000, what: 'the mode to leave the URL in Simple mode' });
        await p.screenshot({ path: path.join(screens, `${prefix}simple.png`) }).catch(() => {});
        // A phone.
        await p.setViewportSize({ width: 390, height: 844 });
        await sleep(800);
        const phone = await overflowReport(p, 390);
        t.data('phone', phone);
        if (phone.overflow) throw new Error(`Simple mode is ${Math.max(phone.scrollWidth, phone.innerWidth)}px wide on a 390px screen (sticking out: ${phone.offenders.map((o) => `${o.el} x ${o.left}..${o.right}`).slice(0, 4).join('; ') || 'unknown'})`);
        await p.screenshot({ path: path.join(screens, `${prefix}simple-mobile.png`) }).catch(() => {});
        const errs = pw.since(0);
        if (errs.length) t.data('pageErrors', errs.slice(0, 6).map((e) => `${e.kind}: ${e.text.split('\n')[0]}`));
        allEvents.push(...pw.events.map((e) => ({ page: 'simple', ...e })));
        t.data('screenshots', [`docs/screens/${prefix}simple.png`, `docs/screens/${prefix}simple-mobile.png`]);
      } finally {
        await ctx.close();
      }
    });

    await step('home', async (t) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      ownShot = true;
      try {
        const p = await ctx.newPage();
        // Keep the test off the network: the sky works from its built-in star list alone.
        await p.route('https://irsa.ipac.caltech.edu/**', (r) => r.abort());
        trackForeign(p);
        const pw = watchPage(p);
        await p.goto(pageUrl({}, null), { waitUntil: 'load' });
        await p.waitForSelector('[data-testid="home"]', { state: 'visible', timeout: 15000 });
        await p.waitForFunction(() => { const c = document.querySelector('.skyglobe-stars'); return !!c && c.width > 300; }, null, { timeout: 10000 });
        await sleep(600);
        // The star layer is drawn: a good share of its pixels are lit.
        const lit = await p.evaluate(() => {
          const c = document.querySelector('.skyglobe-stars');
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n += 1;
          return n;
        });
        t.data('litStarPixels', lit);
        if (lit < 800) throw new Error(`the sky shows almost nothing (${lit} lit pixels)`);
        // The pick-list: open it, see many names, narrow it by typing, pick one.
        await p.locator('[data-testid="home-search"]').click();
        await p.waitForSelector('.picklist:not([hidden]) .picklist-row', { timeout: 5000 });
        const all = await p.locator('.picklist-row').count();
        t.data('namesInList', all);
        if (all < 300) throw new Error(`the pick-list holds only ${all} names`);
        await p.keyboard.type('veg');
        await sleep(200);
        const narrowed = await p.locator('.picklist-row').allInnerTexts();
        t.data('narrowed', narrowed.slice(0, 5));
        if (!narrowed.includes('Vega')) throw new Error('typing "veg" does not offer Vega');
        await p.locator('.picklist-row', { hasText: /^Vega$/ }).click();
        await p.waitForSelector('[data-testid="home-card"]:not([hidden])', { timeout: 5000 });
        const card = (await p.locator('[data-testid="home-card"]').innerText()).replace(/\s+/g, ' ');
        t.data('card', card);
        if (!/Vega/.test(card)) throw new Error(`the card does not name the picked star: "${card}"`);
        await p.screenshot({ path: path.join(screens, `${prefix}home.png`) }).catch(() => {});
        // Dragging the sky moves it; clicking the button opens the star.
        const before = await p.evaluate(() => document.querySelector('.skyglobe-stars').toDataURL().length);
        await sleep(1600);
        await p.mouse.move(640, 400);
        await p.mouse.down();
        await p.mouse.move(420, 330, { steps: 6 });
        await p.mouse.up();
        await sleep(500);
        const after = await p.evaluate(() => document.querySelector('.skyglobe-stars').toDataURL().length);
        if (before === after) t.note('dragging did not visibly change the sky picture');
        await p.locator('[data-testid="home-open"]').click();
        await p.waitForFunction(() => document.documentElement.dataset.screen === 'console', null, { timeout: 15000 });
        await waitFor(() => new URL(p.url()).searchParams.has('ra'), { timeoutMs: 8000, what: 'the star\'s position in the URL' });
        const q = new URL(p.url()).searchParams;
        t.data('opened', { ra: q.get('ra'), dec: q.get('dec'), name: q.get('name') });
        if (q.get('name') !== 'Vega' || Math.abs(Number(q.get('ra')) - 279.23) > 0.05 || Math.abs(Number(q.get('dec')) - 38.78) > 0.05) throw new Error(`opening Vega led to ${p.url()}`);
        // And back to the sky with the Sky button.
        await p.locator('[data-testid="btn-sky"]').click();
        await p.waitForSelector('[data-testid="home"]', { state: 'visible', timeout: 8000 });
        // A phone.
        await p.setViewportSize({ width: 390, height: 844 });
        await sleep(600);
        const phone = await overflowReport(p, 390);
        t.data('phone', phone);
        if (phone.overflow) throw new Error(`the sky start page is ${Math.max(phone.scrollWidth, phone.innerWidth)}px wide on a 390px screen (sticking out: ${phone.offenders.map((o) => `${o.el} x ${o.left}..${o.right}`).slice(0, 4).join('; ') || 'unknown'})`);
        await p.screenshot({ path: path.join(screens, `${prefix}home-mobile.png`) }).catch(() => {});
        const errs = pw.since(0).filter((e) => !/irsa\.ipac\.caltech\.edu|ERR_FAILED/.test(e.text));
        if (errs.length) t.data('pageErrors', errs.slice(0, 6).map((e) => `${e.kind}: ${e.text.split('\n')[0]}`));
        t.data('screenshots', [`docs/screens/${prefix}home.png`, `docs/screens/${prefix}home-mobile.png`]);
      } finally {
        await ctx.close();
      }
    });

    await step('sandbox', async (t) => {
      if (!opts.bundle) t.skip('only meaningful for the single-file bundle (run with --bundle)');
      const host = await desktop.newPage();
      trackForeign(host);
      const hw = watchPage(host);
      pages.push({ name: 'sandbox', watch: hw });
      ownShot = true;
      try {
        const q = [extraQuery, new URLSearchParams(Object.entries(FALLBACK).map(([k, v]) => [k, String(v)])).toString()].join('&');
        await host.goto(`${staticServer.url}/frame.html?${q}`, { waitUntil: 'load' });
        const frame = await waitFor(() => host.frames().find((f) => f !== host.mainFrame() && /tombaugh\.html/.test(f.url())), { timeoutMs: 10000, what: 'the sandboxed iframe' });
        const env = await frame.evaluate(() => {
          let storage = 'ok';
          try { window.localStorage.getItem('x'); } catch (e) { storage = e.name; }
          return { origin: window.origin, storage };
        });
        t.data('frame', env);
        if (env.origin !== 'null') throw new Error(`the iframe origin is ${env.origin}, expected an opaque origin`);
        const s = await waitForMovie(frame, movieTimeout);
        t.data('canvas', { width: s.width, height: s.height, distinctSampledColours: s.distinct });
        await sleep(1500);
        const errs = hw.since(0);
        allEvents.push(...hw.events.map((x) => ({ page: 'sandbox', ...x })));
        if (errs.length) throw new Error(`${errs.length} error(s) inside the sandboxed iframe:\n${errs.slice(0, 6).map((x) => `- ${x.kind}: ${x.text.split('\n')[0]}`).join('\n')}`);
        t.data('requestsOtherThanPageAndApi', foreign);
        if (foreign.length) throw new Error(`during this run the single-file page requested something other than itself and the API:\n${foreign.slice(0, 8).map((u) => `- ${u}`).join('\n')}`);
      } finally {
        await host.screenshot({ path: path.join(screens, `${prefix}sandbox.png`) }).catch(() => {});
        await host.close();
      }
    });

    allEvents.unshift(...watch.events.map((e) => ({ page: 'desktop', ...e })));
  } catch (e) {
    fatal = String((e && e.stack) || e).split('\n').slice(0, 8).join('\n');
    console.error(`FATAL  ${fatal}`);
  } finally {
    for (const fn of cleanup.reverse()) {
      try { await fn(); } catch { /* best effort */ }
    }
  }

  const report = writeReport();
  const s = report.summary;
  const errorEvents = allEvents.filter((e) => ['console.error', 'pageerror', 'request.failed', 'http.error'].includes(e.kind));
  console.log('');
  console.log(`Tombaugh e2e (${mode}): ${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped in ${(report.durationMs / 1000).toFixed(1)} s`);
  if (setup.page) console.log(`page: ${setup.page}`);
  for (const n of setup.notes) console.log(`note: ${n}`);
  if (errorEvents.length) {
    console.log(`${errorEvents.length} console/network error event(s) during the run, first: [${errorEvents[0].page}] ${errorEvents[0].kind}: ${errorEvents[0].text.split('\n')[0]}`);
  }
  console.log(`report: ${path.relative(process.cwd(), reportFile).split(path.sep).join('/')}   screenshots: docs/screens/${prefix}*.png`);
  return report.ok ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }, (e) => {
  console.error(e && e.message ? e.message : e);
  process.exitCode = 2;
});
