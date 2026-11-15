// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Development server (Node only): serves web/ at http://localhost:8787/ and the proxy API at
// /api/*. No dependencies.
//
//   node proxy/dev-server.mjs                          synthetic sky, no network
//   TOMBAUGH_BACKEND=s3 node proxy/dev-server.mjs      live data: NASA's public bucket, own index
//   TOMBAUGH_BACKEND=irsa node proxy/dev-server.mjs    live IRSA / Gaia / CDS
//
// Environment: PORT (default 8787), TOMBAUGH_BACKEND (synthetic | s3 | irsa),
// TOMBAUGH_CACHE_DIR (optional: keep the cache on disk so IRSA answers survive a restart),
// TOMBAUGH_QUIET=1 (no per-request log lines).

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createHandler } from './src/handler.js';
import { createMemoryCache, isSafeKey } from './src/cache.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, '..', 'web');
const PROXY_ROOT = HERE;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

const NO_CACHE = { 'cache-control': 'no-store, max-age=0' };

/** A cache in a directory, for TOMBAUGH_CACHE_DIR. Same contract as the caches in cache.js. */
export function createDiskCache(dir) {
  const fileOf = (key) => path.join(dir, ...key.split('/'));
  return {
    kind: 'disk',
    async get(key, { maxAgeSeconds } = {}) {
      if (!isSafeKey(key)) return null;
      try {
        const file = fileOf(key);
        if (Number.isFinite(maxAgeSeconds)) {
          const stat = await fsp.stat(file);
          if (Date.now() - stat.mtimeMs > maxAgeSeconds * 1000) return null;
        }
        const buf = await fsp.readFile(file);
        return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      } catch (err) {
        if (err && err.code !== 'ENOENT') console.warn(`[tombaugh cache] disk get ${key}: ${err.message}`);
        return null;
      }
    },
    async put(key, data) {
      if (!isSafeKey(key)) return false;
      try {
        const file = fileOf(key);
        await fsp.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        const bytes = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        await fsp.writeFile(tmp, bytes);
        await fsp.rename(tmp, file); // atomic: readers never see half a file
        return true;
      } catch (err) {
        console.warn(`[tombaugh cache] disk put ${key}: ${err.message}`);
        return false;
      }
    },
    async delete(key) {
      if (!isSafeKey(key)) return false;
      try {
        await fsp.unlink(fileOf(key));
        return true;
      } catch {
        return false;
      }
    },
  };
}

function send(res, status, headers, body) {
  res.writeHead(status, { ...NO_CACHE, ...headers });
  res.end(body);
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' }, 'Method not allowed\n');
    return;
  }
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    send(res, 400, { 'content-type': 'text/plain; charset=utf-8' }, 'Bad path\n');
    return;
  }
  if (rel.includes('\0')) {
    send(res, 400, { 'content-type': 'text/plain; charset=utf-8' }, 'Bad path\n');
    return;
  }
  // The page's in-browser data mode imports the proxy's own modules (web/src/local/localapi.js
  // imports ../../../proxy/src/handler.js), so /proxy/src and /proxy/fixtures are served too.
  let root = WEB_ROOT;
  const shared = /^\/proxy\/(src|fixtures)\/[A-Za-z0-9_.-]+\.js$/.exec(rel);
  if (shared) {
    root = PROXY_ROOT;
    rel = rel.slice('/proxy'.length);
  }
  let file = path.resolve(root, `.${path.posix.normalize(`/${rel}`)}`);
  if (file !== root && !file.startsWith(root + path.sep)) {
    send(res, 403, { 'content-type': 'text/plain; charset=utf-8' }, 'Forbidden\n');
    return;
  }
  let stat = await fsp.stat(file).catch(() => null);
  if (stat && stat.isDirectory()) {
    file = path.join(file, 'index.html');
    stat = await fsp.stat(file).catch(() => null);
  }
  if (!stat || !stat.isFile()) {
    // SPA fallback: unknown paths without a file extension get the page; missing assets are 404.
    if (path.extname(rel) === '') {
      file = path.join(WEB_ROOT, 'index.html');
      stat = await fsp.stat(file).catch(() => null);
    }
    if (!stat || !stat.isFile()) {
      const hint = path.extname(rel) === '' ? 'web/index.html does not exist yet. The API is at /api/health\n' : 'Not found\n';
      send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, hint);
      return;
    }
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { ...NO_CACHE, 'content-type': type, 'content-length': String(stat.size) });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/** Node request -> Web Request (the body is streamed, not buffered). */
function toWebRequest(req, origin) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else if (value !== undefined) headers.set(name, value);
  }
  const init = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req);
    init.duplex = 'half';
  }
  return new Request(new URL(req.url, origin), init);
}

/** Web Response -> Node response (streamed). */
async function sendWebResponse(response, res) {
  const headers = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  const onClose = () => reader.cancel().catch(() => {});
  res.on('close', onClose);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise((resolve) => res.once('drain', resolve));
    }
  } finally {
    res.off('close', onClose);
    res.end();
  }
}

/**
 * startServer({ port, backend, host, quiet, cacheDir, handlerOptions }) -> Promise<{ server, url, port, close() }>
 * port 0 picks a free port (used by tests).
 */
export async function startServer({
  port = Number(process.env.PORT) || 8787,
  backend = process.env.TOMBAUGH_BACKEND || 'synthetic',
  host = process.env.HOST || undefined,
  quiet = process.env.TOMBAUGH_QUIET === '1',
  cacheDir = process.env.TOMBAUGH_CACHE_DIR || '',
  handlerOptions = {},
} = {}) {
  if (backend !== 'synthetic' && backend !== 'irsa' && backend !== 's3') {
    throw new Error(`TOMBAUGH_BACKEND must be "synthetic", "s3" or "irsa", got "${backend}"`);
  }
  let version = '0.1.0';
  try {
    version = JSON.parse(await fsp.readFile(path.resolve(HERE, '..', 'package.json'), 'utf8')).version || version;
  } catch {
    // keep the default
  }
  const cache = cacheDir ? createDiskCache(path.resolve(cacheDir, backend)) : createMemoryCache();
  const handler = createHandler({
    fetchImpl: globalThis.fetch,
    cache,
    backend,
    version,
    log: quiet ? () => {} : (message) => console.log(`[tombaugh] ${message}`),
    ...handlerOptions,
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        const response = await handler(toWebRequest(req, `http://${req.headers.host || 'localhost'}`));
        await sendWebResponse(response, res);
      } else {
        await serveStatic(req, res, url.pathname);
      }
    } catch (err) {
      console.error(`[tombaugh] dev server error on ${req.method} ${req.url}: ${err && err.stack ? err.stack : err}`);
      if (!res.headersSent) {
        send(res, 500, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }, JSON.stringify({ error: 'Dev server error', retryable: true }));
      } else {
        res.destroy();
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') reject(new Error(`Port ${port} is in use. Set PORT to another port.`));
      else reject(err);
    });
    server.listen(port, host, resolve);
  });
  const actual = server.address().port;
  const url = `http://localhost:${actual}/`;
  return {
    server,
    url,
    port: actual,
    backend,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      }),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  startServer()
    .then(({ url, backend }) => {
      console.log(`Tombaugh dev server: ${url}`);
      console.log(`  page     ${url}   (files from ${WEB_ROOT})`);
      console.log(`  API      ${url}api/health`);
      console.log(`  backend  ${backend}${backend === 'synthetic' ? ' (fake sky, no network; TOMBAUGH_BACKEND=s3 for live data)' : backend === 's3' ? ' (live: public SPHEREx bucket on AWS, own exposure index, Gaia and CDS)' : ' (live IRSA, Gaia and CDS)'}`);
    })
    .catch((err) => {
      console.error(err && err.message ? err.message : err);
      process.exit(1);
    });
}
