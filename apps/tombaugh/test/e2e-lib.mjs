// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// test/e2e-lib.mjs - helpers shared by test/e2e.mjs and tools/build.test.mjs:
// Playwright loading, free ports, a throwaway static server, dev-server lifecycle, a step runner
// that keeps going after a failure, and defensive DOM probes (canvas sampling, captions, overflow).

import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------------------------
// Playwright
// ---------------------------------------------------------------------------------------------

/**
 * Load Playwright. A plain `import 'playwright'` only works when the package is resolvable from
 * this file; globally installed copies are found through NODE_PATH / the global node_modules.
 */
export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch { /* fall through to CommonJS resolution, which honours NODE_PATH */ }
  const require = createRequire(import.meta.url);
  const candidates = ['playwright'];
  for (const dir of (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)) candidates.push(path.join(dir, 'playwright'));
  candidates.push(path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'playwright'));
  candidates.push('/usr/local/lib/node_modules/playwright', '/usr/lib/node_modules/playwright');
  let lastError = null;
  for (const c of candidates) {
    try { return require(c); } catch (e) { lastError = e; }
  }
  throw new Error(`Playwright is not installed where Node can find it (${lastError ? lastError.message.split('\n')[0] : 'no candidates'})`);
}

// ---------------------------------------------------------------------------------------------
// Ports and servers
// ---------------------------------------------------------------------------------------------

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export function portOpen(port, host = 'localhost', timeoutMs = 500) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, { timeoutMs = 10000, intervalMs = 150, what = 'condition' } = {}) {
  const t0 = Date.now();
  let lastError = null;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) { lastError = e; }
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`timed out after ${Math.round((Date.now() - t0) / 100) / 10} s waiting for ${what}${lastError ? ` (last error: ${String(lastError.message).split('\n')[0]})` : ''}`);
    }
    await sleep(intervalMs);
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};

/**
 * Throwaway static file server. `routes` maps a URL path to a string/Buffer body or to a
 * function (req, res) for anything dynamic. Every request is recorded in `requests`.
 */
export async function startStaticServer(dir, { port = 0, routes = {}, index = 'index.html' } = {}) {
  const requests = [];
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push(url.pathname + url.search);
    const route = routes[url.pathname];
    if (typeof route === 'function') return route(req, res, url);
    if (route !== undefined) {
      res.writeHead(200, { 'content-type': TYPES[path.extname(url.pathname)] || 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(route);
    }
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { rel = url.pathname; }
    if (rel.endsWith('/')) rel += index;
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, resolve); });
  const actual = server.address().port;
  return {
    port: actual,
    url: `http://localhost:${actual}`,
    requests,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

/**
 * Start proxy/dev-server.mjs on a free port (PORT env) and wait until it answers.
 * Falls back to the port the server prints, or 8787, if it ignores PORT.
 */
export async function startDevServer({ projectDir = PROJECT, port, env = {}, timeoutMs = 20000, script = 'proxy/dev-server.mjs' } = {}) {
  const file = path.resolve(projectDir, script);
  if (!fs.existsSync(file)) throw new Error(`${script} does not exist yet`);
  const wanted = port || await freePort();
  const busy8787 = await portOpen(8787);
  const logs = [];
  const child = spawn(process.execPath, [file], {
    cwd: projectDir,
    env: { ...process.env, PORT: String(wanted), TOMBAUGH_PORT: String(wanted), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let exited = null;
  let printed = null;
  const onData = (chunk) => {
    const text = String(chunk);
    logs.push(text);
    if (logs.length > 400) logs.splice(0, 100);
    const mm = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1?\]|0\.0\.0\.0):(\d+)/.exec(text);
    if (mm && !printed) printed = Number(mm[1]);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  // Never leave the server behind, even if the caller dies with an uncaught exception.
  const killOnExit = () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
  process.on('exit', killOnExit);
  child.on('exit', (code, signal) => { exited = { code, signal }; process.removeListener('exit', killOnExit); });
  const stop = () => new Promise((resolve) => {
    if (exited) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 2000).unref();
  });

  const t0 = Date.now();
  let actual = null;
  let note = null;
  while (Date.now() - t0 < timeoutMs) {
    if (exited) throw new Error(`dev server exited early (code ${exited.code}, signal ${exited.signal}):\n${logs.join('').slice(-1500)}`);
    if (await portOpen(wanted)) { actual = wanted; break; }
    if (printed && printed !== wanted && await portOpen(printed)) {
      actual = printed;
      note = `dev server ignored PORT=${wanted} and listens on ${printed}`;
      break;
    }
    if (!busy8787 && Date.now() - t0 > 3000 && await portOpen(8787)) {
      actual = 8787;
      note = `dev server ignored PORT=${wanted} and listens on 8787`;
      break;
    }
    await sleep(100);
  }
  if (!actual) {
    await stop();
    throw new Error(`dev server did not open port ${wanted} within ${timeoutMs} ms:\n${logs.join('').slice(-1500)}`);
  }
  return { url: `http://localhost:${actual}`, port: actual, child, logs, note, stop, exited: () => exited };
}

// ---------------------------------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------------------------------

/**
 * Collects independently reported steps. A failing step never aborts the others.
 * step(name, title, fn): fn receives a `t` with note(text) and data(key, value).
 */
export function createRunner({ only = null, log = console.log, onStepEnd = null } = {}) {
  const results = [];
  const wanted = only ? new Set(String(only).split(',').map((s) => s.trim()).filter(Boolean)) : null;
  async function step(name, title, fn) {
    if (wanted && !wanted.has(name)) {
      results.push({ name, title, status: 'skipped', ms: 0, notes: [], data: {} });
      return null;
    }
    const rec = { name, title, status: 'passed', ms: 0, notes: [], data: {}, error: null, screenshot: null };
    const t = {
      note: (text) => { rec.notes.push(String(text)); },
      data: (k, v) => { rec.data[k] = v; },
      skip: (why) => { const e = new Error(why); e.skip = true; throw e; },
    };
    const t0 = Date.now();
    try {
      await fn(t);
    } catch (e) {
      if (e && e.skip) { rec.status = 'skipped'; rec.notes.push(e.message); } else {
        rec.status = 'failed';
        rec.error = String((e && e.message) || e).split('\n').slice(0, 12).join('\n');
      }
    }
    rec.ms = Date.now() - t0;
    if (onStepEnd) {
      try { await onStepEnd(rec); } catch (e) { rec.notes.push(`after-step hook failed: ${String(e.message).split('\n')[0]}`); }
    }
    results.push(rec);
    const mark = rec.status === 'passed' ? 'PASS' : rec.status === 'failed' ? 'FAIL' : 'SKIP';
    log(`${mark}  ${name.padEnd(12)} ${title}  (${rec.ms} ms)`);
    if (rec.error) log(`      ${rec.error.replace(/\n/g, '\n      ')}`);
    for (const n of rec.notes) log(`      note: ${n}`);
    return rec;
  }
  const summary = () => ({
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    total: results.length,
  });
  return { step, results, summary, selected: (name) => !wanted || wanted.has(name) };
}

// ---------------------------------------------------------------------------------------------
// Page probes
// ---------------------------------------------------------------------------------------------

/** Record console errors, uncaught exceptions, failed requests and HTTP errors of a page. */
export function watchPage(page) {
  const events = [];
  const add = (kind, text, extra = {}) => events.push({ kind, text: String(text).slice(0, 600), at: Date.now(), ...extra });
  page.on('console', (msg) => {
    if (msg.type() === 'error') add('console.error', msg.text(), { location: `${msg.location().url || ''}:${msg.location().lineNumber ?? ''}` });
    else if (msg.type() === 'warning') add('console.warning', msg.text());
  });
  page.on('pageerror', (err) => add('pageerror', `${err.message}${err.stack ? `\n${String(err.stack).split('\n').slice(0, 4).join('\n')}` : ''}`));
  page.on('requestfailed', (req) => {
    const failure = req.failure();
    add(failure && /ERR_ABORTED/.test(failure.errorText) ? 'request.aborted' : 'request.failed', `${req.method()} ${req.url()} - ${failure ? failure.errorText : 'failed'}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) add('http.error', `${res.status()} ${res.request().method()} ${res.url()}`);
  });
  return {
    events,
    mark: () => events.length,
    since: (mark, kinds = ['console.error', 'pageerror', 'request.failed', 'http.error']) => events.slice(mark).filter((e) => kinds.includes(e.kind)),
  };
}

/** First locator of `candidates` (array of Locator) that has a visible element; null if none. */
export async function firstVisible(candidates, { timeoutMs = 0 } = {}) {
  const t0 = Date.now();
  for (;;) {
    for (const loc of candidates) {
      try {
        const n = await loc.count();
        for (let i = 0; i < Math.min(n, 8); i++) {
          const el = loc.nth(i);
          if (await el.isVisible()) return el;
        }
      } catch { /* detached or invalid selector: try the next candidate */ }
    }
    if (Date.now() - t0 >= timeoutMs) return null;
    await sleep(150);
  }
}

/**
 * Sample every visible canvas of a frame/page. Returns [{ index, width, height, area, distinct,
 * hash, inViewer, excluded, cx, cy }] where `distinct` counts different sampled colours and
 * cx/cy is the viewport centre of the canvas.
 */
export async function sampleCanvases(target) {
  return target.evaluate(() => {
    const out = [];
    const all = Array.from(document.querySelectorAll('canvas'));
    const tmp = document.createElement('canvas');
    all.forEach((c, index) => {
      const r = c.getBoundingClientRect();
      const style = getComputedStyle(c);
      const visible = r.width > 4 && r.height > 4 && style.visibility !== 'hidden' && style.display !== 'none' &&
        c.getClientRects().length > 0 && Number(style.opacity) > 0.01;
      if (!visible || !c.width || !c.height) return;
      let distinct = 0;
      let hash = 0;
      let error = null;
      try {
        const w = Math.min(c.width, 512);
        const h = Math.min(c.height, 512);
        tmp.width = w;
        tmp.height = h;
        const g = tmp.getContext('2d', { willReadFrequently: true });
        g.imageSmoothingEnabled = false;
        g.clearRect(0, 0, w, h);
        g.drawImage(c, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h).data;
        const seen = new Set();
        const sx = Math.max(1, Math.floor(w / 64));
        const sy = Math.max(1, Math.floor(h / 64));
        let hsh = 2166136261;
        for (let y = Math.floor(sy / 2); y < h; y += sy) {
          for (let x = Math.floor(sx / 2); x < w; x += sx) {
            const o = (y * w + x) * 4;
            const v = (d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3];
            seen.add(v);
            hsh = Math.imul(hsh ^ v, 16777619);
          }
        }
        distinct = seen.size;
        hash = hsh >>> 0;
      } catch (e) { error = String(e.message || e); }
      const closest = (sel) => { try { return !!c.closest(sel); } catch { return false; } };
      out.push({
        index, width: c.width, height: c.height, area: Math.round(r.width * r.height), distinct, hash, error,
        inViewer: closest('[data-testid="viewer"], [class*="viewer" i], #viewer'),
        excluded: closest('[data-testid="target-card"], [class*="landing" i], [class*="hero" i], [class*="card" i], [class*="fog" i], [class*="explain" i]'),
        cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2),
        onScreen: r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth,
      });
    });
    return out;
  });
}

/** The canvas that shows the movie: prefers one inside the viewer, then the largest one. */
export function pickViewerCanvas(samples) {
  const inViewer = samples.filter((s) => s.inViewer);
  const pool = inViewer.length ? inViewer : samples.filter((s) => !s.excluded);
  if (!pool.length) return null;
  // Overlay canvases are mostly transparent: prefer the richest picture, then the largest.
  return [...pool].sort((a, b) => (b.distinct > 8) - (a.distinct > 8) || b.area - a.area || b.distinct - a.distinct)[0];
}

/**
 * Horizontal overflow report. `expectedWidth` is the device width the context was created with:
 * with mobile emulation Chromium widens the layout viewport (innerWidth) to fit overflowing
 * content, so comparing scrollWidth with innerWidth alone would hide the overflow. `offenders`
 * are the elements that stick out and are not clipped or scrolled by an ancestor that fits.
 */
export async function overflowReport(page, expectedWidth = null) {
  return page.evaluate((expected) => {
    const doc = document.documentElement;
    const width = expected || window.innerWidth;
    const offenders = [];
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= width + 1) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      let contained = false;
      let depth = 0;
      for (let a = el.parentElement; a && a !== doc; a = a.parentElement) {
        depth++;
        if (!contained && getComputedStyle(a).overflowX !== 'visible' && a.getBoundingClientRect().right <= width + 1) contained = true;
      }
      if (contained) continue;
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
      offenders.push({ el: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), depth });
    }
    offenders.sort((a, b) => b.depth - a.depth || b.right - a.right);
    const scrollWidth = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0);
    return {
      expectedWidth: width,
      innerWidth: window.innerWidth,
      scrollWidth,
      overflow: Math.max(scrollWidth, window.innerWidth) > width + 1,
      offenders: offenders.slice(0, 8).map(({ depth, ...rest }) => rest),
    };
  }, expectedWidth);
}

/** Text of an element, whitespace-normalised; null when the locator is null. */
export async function textOf(locator) {
  if (!locator) return null;
  try { return (await locator.innerText()).replace(/\s+/g, ' ').trim(); } catch { return null; }
}
