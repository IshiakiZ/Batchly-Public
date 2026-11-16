// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// tools/demo/make-video.mjs - render the 30-second demo video from real captures of the tool.
//
//   node tools/demo/make-video.mjs                         -> docs/demo/tombaugh-demo.mp4
//   node tools/demo/make-video.mjs --live example.org/x    the address shown on the last card
//   node tools/demo/make-video.mjs --stills                also write a few stills (docs/demo/stills/)
//   node tools/demo/make-video.mjs --page video-narrated.html --voice <folder> --out <file>
//       the narrated cut: the page's spoken lines (window.VOICE, <folder>/<clip>.mp3) under the picture.
//       The clips are an AI-generated voice and are not part of this repository.
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
const pageFile = opt('page', 'video.html');
const voiceDir = opt('voice', '');

const { chromium } = require('playwright');
const tmp = path.join(os.tmpdir(), `tombaugh-demo-${process.pid}`);
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const url = `${pathToFileURL(path.join(here, pageFile)).href}?live=${encodeURIComponent(live)}`;
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
  const dir = path.resolve(root, opt('stills-dir', 'docs/demo/stills'));
  mkdirSync(dir, { recursive: true });
  const times = (await page.evaluate(() => window.STILLS || null)) || [1.0, 2.5, 5.0, 9.8, 12.0, 16.0, 21.0, 24.0, 25.8, 28.8];
  for (const t of times) {
    await page.evaluate((x) => window.renderAt(x), t);
    await page.screenshot({ path: path.join(dir, `t${t.toFixed(1).replace('.', '_')}.jpg`), type: 'jpeg', quality: 88 });
  }
}
const voice = voiceDir ? (await page.evaluate(() => window.VOICE || [])) : [];
await browser.close();

// With --voice, each spoken line of the page (window.VOICE) starts at its second under the picture.
const inputs = ['-framerate', String(FPS), '-i', path.join(tmp, 'f%04d.jpg')];
const sound = [];
if (voice.length) {
  const parts = [];
  voice.forEach((v, k) => {
    const file = path.resolve(root, voiceDir, `${v.clip}.mp3`);
    if (!existsSync(file)) {
      console.error(`missing clip: ${file}`);
      process.exit(1);
    }
    inputs.push('-i', file);
    parts.push(`[${k + 1}:a]aresample=48000,adelay=${Math.round(v.at * 1000)}:all=1[v${k}]`);
  });
  parts.push(`${voice.map((_, k) => `[v${k}]`).join('')}amix=inputs=${voice.length}:normalize=0,apad[a]`);
  sound.push('-filter_complex', parts.join(';'), '-map', '0:v', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-t', (frames / FPS).toFixed(3));
}
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, ...sound,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'inherit' });
rmSync(tmp, { recursive: true, force: true });
if (ff.status !== 0 || !existsSync(out)) {
  console.error('ffmpeg failed');
  process.exit(1);
}
console.log(`${out}: ${frames} frames, ${(frames / FPS).toFixed(1)} s`);
