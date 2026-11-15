// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// tools/demo/make-slides.mjs - print tools/demo/slides.html to docs/demo/tombaugh-slides.pdf
// (seven pages of 1920 x 1080), and with --png also write each slide as an image.
//
//   node tools/demo/make-slides.mjs [--png]
//
// Needs Playwright (Chromium).

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const out = path.join(root, 'docs/demo/tombaugh-slides.pdf');
const { chromium } = require('playwright');

mkdirSync(path.dirname(out), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(here, 'slides.html')).href);
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => Promise.all([...document.images].map((im) => (im.complete ? null : new Promise((res) => { im.onload = im.onerror = res; })))));
await page.pdf({ path: out, width: '1920px', height: '1080px', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
if (process.argv.includes('--png')) {
  const dir = path.join(root, 'docs/demo/slides');
  mkdirSync(dir, { recursive: true });
  const slides = await page.$$('.slide');
  for (let i = 0; i < slides.length; i += 1) {
    await slides[i].screenshot({ path: path.join(dir, `slide-${i + 1}.jpg`), type: 'jpeg', quality: 88 });
  }
}
await browser.close();
console.log(out);
