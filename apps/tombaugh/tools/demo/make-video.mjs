// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// tools/demo/make-video.mjs - render the 30-second demo video from real captures of the tool.
//
//   node tools/demo/make-video.mjs                         -> docs/demo/tombaugh-demo.mp4
//   node tools/demo/make-video.mjs --live example.org/x    the address shown on the last card
//   node tools/demo/make-video.mjs --stills                also write a few stills (docs/demo/stills/)
//
// Needs Playwright (Chromium) and ffmpeg on the PATH. tools/demo/video.html draws the picture for a
// time t; this script steps t at 30 frames a second, photographs each frame and encodes them.
// The frames in docs/demo/frames/ are screen captures of the live tool on real SPHEREx data.

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const FPS = 30;
const out = path.resolve(root, opt('out', 'docs/demo/tombaugh-demo.mp4'));
const live = opt('live', 'batch-ly.com/tombaugh');
const wantStills = args.includes('--stills');

const { chromium } = require('playwright');
const tmp = path.join(os.tmpdir(), `tombaugh-demo-${process.pid}`);
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const url = `${pathToFileURL(path.join(here, 'video.html')).href}?live=${encodeURIComponent(live)}`;
await page.goto(url);
await page.evaluate(() => window.ready);
await page.evaluate(() => document.fonts.ready);
const total = await page.evaluate(() => window.TOTAL);
const frames = Math.round(total * FPS);
for (let i = 0; i < frames; i += 1) {
  await page.evaluate((t) => window.renderAt(t), i / FPS);
  // Let the images that changed this frame decode before the photograph.
  await page.evaluate(() => Promise.all([...document.images].filter((im) => im.src && !im.complete).map((im) => im.decode().catch(() => {}))));
  await page.screenshot({ path: path.join(tmp, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 95 });
  if (i % 150 === 0) console.log(`frame ${i} of ${frames}`);
}
if (wantStills) {
  const dir = path.join(root, 'docs/demo/stills');
  mkdirSync(dir, { recursive: true });
  for (const t of [1.0, 2.5, 5.0, 9.8, 12.0, 16.0, 21.0, 24.0, 25.8, 28.8]) {
    await page.evaluate((x) => window.renderAt(x), t);
    await page.screenshot({ path: path.join(dir, `t${t.toFixed(1).replace('.', '_')}.jpg`), type: 'jpeg', quality: 88 });
  }
}
await browser.close();

const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(tmp, 'f%04d.jpg'),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'inherit' });
rmSync(tmp, { recursive: true, force: true });
if (ff.status !== 0 || !existsSync(out)) {
  console.error('ffmpeg failed');
  process.exit(1);
}
console.log(`${out}: ${frames} frames, ${(frames / FPS).toFixed(1)} s`);
