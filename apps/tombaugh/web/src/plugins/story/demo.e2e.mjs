// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// demo.e2e.mjs - drives demo.html with Playwright: the launcher, the tour and its Stop button,
// and the 30-second film in recording mode, timed on the wall clock from the start keypress.
// Not a `node --test` file (it needs a browser and a server):
//   python3 -m http.server 8795 --directory web &
//   node web/src/plugins/story/demo.e2e.mjs [--shots docs/screens]
// PLAYWRIGHT=/path/to/playwright/index.mjs overrides where Playwright is imported from.

import { getStory } from './script.js';

const BASE = process.env.STORY_DEMO_URL || 'http://localhost:8795/src/plugins/story/demo.html';
const shotsArg = process.argv.indexOf('--shots');
const SHOTS = shotsArg > 0 ? process.argv[shotsArg + 1] : '';

async function loadPlaywright() {
  for (const spec of [process.env.PLAYWRIGHT, 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try {
      return await import(spec);
    } catch {
      // try the next place
    }
  }
  throw new Error('Playwright was not found');
}

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const problems = [];
const watch = (page) => {
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
};
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/plugin-story-${name}.png` });
};
const appState = (page) => page.evaluate(() => {
  const s = window.fakeApp.store.get();
  return { name: s.name, view: s.view, det: s.det, gaia: s.gaia, fov: s.fov };
});

try {
  // ---- 1. launcher, tour, Stop tour -----------------------------------------------------------
  const page = await context.newPage();
  watch(page);
  await page.goto(BASE);
  await page.waitForSelector('html[data-ready="1"]');
  await page.waitForFunction(() => window.fakeApp.movie().frames.length > 0);
  const before = await appState(page);
  check((await page.locator('[data-testid="story-layer"]').count()) === 0, 'no caption layer until a story starts');
  check((await page.locator('#toolstrip [data-tool="story-tour"]').count()) === 1, 'the Tour tool is in the toolbar');
  await page.click('#tab-story');
  const listed = await page.locator('.tbs-launch__item').count();
  check(listed === 7, `the launcher lists 7 stories (${listed})`);
  await shot(page, 'launcher');

  await page.click('#toolstrip [data-tool="story-tour"]');
  await page.waitForSelector('[data-testid="story-caption"].is-on');
  const first = await page.textContent('[data-testid="story-caption"] .tbs-text');
  check(/one patch of sky/.test(first), `the tour opens with its first caption ("${first}")`);
  const spoken = await page.textContent('[data-testid="story-live"]');
  check(spoken.startsWith('Welcome. This is one patch of sky'), `the caption is announced to screen readers ("${spoken}")`);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('[data-testid="story-spotlight"]').style.opacity === '1');
  await page.waitForTimeout(900);
  await shot(page, 'tour');
  check((await appState(page)).name === "Barnard's Star", 'the tour went to Barnard\'s Star');
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  check(await page.evaluate(() => window.story.runner().state()) === 'paused', 'Space pauses');
  await page.keyboard.press('Space');
  check(await page.evaluate(() => window.story.runner().state()) === 'running', 'Space resumes');
  await page.click('[data-testid="story-stop"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="story-layer"]'));
  await page.waitForFunction(() => window.fakeApp.movie().frames.length > 0);
  const after = await appState(page);
  check(JSON.stringify(after) === JSON.stringify(before), `Stop tour restores the view (${JSON.stringify(after)})`);
  check(await page.evaluate(() => !document.documentElement.classList.contains('tbs-recording')), 'no recording mode left behind');

  // A target story from the launcher, stopped with Esc.
  await page.click('.tbs-launch__btn[data-story="rw-aur"]');
  await page.waitForSelector('[data-testid="story-caption"].is-on');
  check((await page.textContent('[data-testid="story-caption"] .tbs-title')) === 'RW Aurigae', 'a target story starts from the launcher');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-testid="story-layer"]'));
  check(JSON.stringify(await appState(page)) === JSON.stringify(before), 'Esc restores the view too');
  await page.close();

  // ---- 2. the film, in recording mode ---------------------------------------------------------
  const film = await context.newPage();
  watch(film);
  await film.goto(`${BASE}?story=demo&record=1`);
  await film.waitForFunction(() => window.story && window.story.runner());
  await film.evaluate(() => {
    const r = window.story.runner();
    window.__captions = [];
    window.__skipped = [];
    r.on('start', () => (window.__t0 = performance.now()));
    r.on('caption', (e) => window.__captions.push({ t: performance.now() - (window.__t0 || performance.now()), id: e.id, text: e.caption ? e.caption.text : null, card: e.caption ? e.caption.card || '' : '' }));
    r.on('skipped', (e) => window.__skipped.push({ reason: e.reason, cond: e.cond || '', action: e.action ? e.action.type : '' }));
    r.on('done', (e) => (window.__done = { wall: performance.now() - window.__t0, reported: e.wallMs }));
  });
  const status = film.locator('[data-testid="story-status"]');
  const preparing = await status.textContent();
  check(/Preparing the demonstration/.test(preparing), `a discreet preparation line ("${preparing.trim()}")`);
  await shot(film, 'preparing');
  await film.waitForFunction(() => window.story.runner().state() === 'ready', null, { timeout: 60000 });
  check(/Ready\. Press Space to start recording/.test(await status.textContent()), 'ready prompt after the preload');
  check(await film.evaluate(() => document.documentElement.classList.contains('tbs-recording')), 'recording mode is on');
  check(await film.evaluate(() => getComputedStyle(document.querySelector('#topbar')).display === 'none' && getComputedStyle(document.querySelector('#tabs')).display === 'none'), 'page chrome is hidden in recording mode');
  check(await film.evaluate(() => window.__captions.length === 0), 'no caption before the keypress');
  await shot(film, 'ready');

  const steps = getStory('demo').steps;
  const at = async (seconds, t0) => {
    const wait = t0 + seconds * 1000 - Date.now();
    if (wait > 0) await film.waitForTimeout(wait);
  };
  const t0 = Date.now();
  await film.keyboard.press('Space');
  await at(0.6, t0);
  check(await film.locator('[data-testid="story-card"].is-title.is-on').count() === 1, 'the title card is up');
  await shot(film, 'title');
  await at(2.6, t0);
  await shot(film, 'caption-flicker');
  await at(7.0, t0);
  check(await film.evaluate(() => document.querySelector('[data-testid="story-spotlight"]').style.opacity === '1'), 'the spotlight is on the star');
  check((await film.textContent('[data-testid="story-tag"]')) === 'Synthetic data', 'a stand-in picture is labelled "Synthetic data"');
  await shot(film, 'caption-passes');
  await at(11.0, t0);
  await shot(film, 'caption-residual');
  await at(14.5, t0);
  const motion = await film.textContent('[data-testid="story-caption"] .tbs-text');
  check(/^Tombaugh: \d+\.\d\d ± \d\.\d\d arcsec\/yr\. Gaia: \d+\.\d\d arcsec\/yr\.$/.test(motion), `the motion caption quotes what the tool measured ("${motion}")`);
  await shot(film, 'caption-motion');
  await at(17.6, t0);
  await shot(film, 'caption-spectrum');
  await at(21.0, t0);
  await shot(film, 'caption-lens');
  await at(23.4, t0);
  const address = await film.textContent('[data-testid="story-url"]');
  check(/view=lens/.test(address) && !/story=|record=/.test(address), `the address chip shows the link to this view ("${address}")`);
  await shot(film, 'caption-link');
  await at(26.0, t0);
  check(await film.evaluate(() => document.querySelector('#map-dialog').open), 'the sky map is open');
  // Is the caption really painted above the modal dialog? Compare the band with and without the layer.
  const clip = { x: 40, y: 610, width: 600, height: 90 };
  const withLayer = await film.screenshot({ clip });
  await film.evaluate(() => (document.querySelector('.tbs-layer').style.visibility = 'hidden'));
  const withoutLayer = await film.screenshot({ clip });
  await film.evaluate(() => (document.querySelector('.tbs-layer').style.visibility = ''));
  check(!withLayer.equals(withoutLayer), 'the caption is painted above the sky map dialog');
  check(await film.evaluate(() => /12,288/.test(document.querySelector('#map-count').textContent) && document.querySelector('#map-count').getBoundingClientRect().bottom < document.querySelector('[data-testid="story-caption"]').getBoundingClientRect().top), 'the count of opened patches is not hidden behind the caption');
  await shot(film, 'caption-map');
  await at(28.2, t0);
  check(await film.locator('[data-testid="story-card"].is-end.is-on').count() === 1, 'the end card is up');
  await shot(film, 'end');
  await film.waitForFunction(() => window.__done, null, { timeout: 15000, polling: 'raf' });
  const wallNode = Date.now() - t0;
  const done = await film.evaluate(() => window.__done);
  check(wallNode <= 30000, `the film finished ${(wallNode / 1000).toFixed(2)} s after the keypress, seen from outside (limit 30.0 s)`);
  check(done.wall <= 30000 && done.wall >= 28900, `the film ran ${(done.wall / 1000).toFixed(3)} s in the page (planned 29 s)`);

  const captions = await film.evaluate(() => window.__captions);
  const seen = new Set(captions.filter((c) => c.text !== null).map((c) => c.id));
  const missing = steps.map((s) => s.id).filter((id) => !seen.has(id));
  check(missing.length === 0, `every caption appeared (${seen.size} of ${steps.length}${missing.length ? `, missing ${missing}` : ''})`);
  let late = 0;
  let cursor = 0;
  for (const step of steps) {
    const c = captions.find((x) => x.id === step.id);
    if (c && Math.abs(c.t - cursor * 1000) > 120) late += 1;
    cursor += step.duration;
  }
  check(late === 0, 'every caption appeared within 0.12 s of its scheduled time');
  const skipped = await film.evaluate(() => window.__skipped);
  check(skipped.length === 0, `nothing was skipped (${JSON.stringify(skipped)})`);

  // The end card is held in recording mode; a key lets go and everything is put back.
  await film.waitForTimeout(600);
  check(await film.locator('[data-testid="story-card"].is-end.is-on').count() === 1, 'the end card is held after the film, for a clean tail');
  await film.keyboard.press('Escape');
  await film.waitForFunction(() => !document.querySelector('[data-testid="story-layer"]'));
  const restored = await appState(film);
  check(restored.name === 'M101' && restored.view === 'passes' && restored.det === 2, `afterwards the view is as it was (${JSON.stringify(restored)})`);
  check(await film.evaluate(() => !document.documentElement.classList.contains('tbs-recording') && !document.querySelector('#map-dialog').open), 'recording mode and the sky map are gone');
  await film.close();

  // ---- 3. a slow app: the film keeps its length and skips gracefully --------------------------
  const slow = await context.newPage();
  watch(slow);
  await slow.goto(`${BASE}?delay=12`);
  await slow.waitForSelector('html[data-ready="1"]');
  await slow.evaluate(() => {
    window.story.start('demo', { speed: 4 });
    const r = window.story.runner();
    r.on('ready', () => {
      window.__t0 = performance.now();
      r.start();
    });
    r.on('done', () => (window.__done = performance.now() - window.__t0));
    r.stop = r.stop.bind(r);
  });
  await slow.waitForFunction(() => window.__done, null, { timeout: 240000 });
  const slowWall = await slow.evaluate(() => window.__done);
  check(Math.abs(slowWall - 7250) < 200, `with 12 times slower loading and speed 4 the film still takes 29 / 4 s (${(slowWall / 1000).toFixed(2)} s)`);
  await slow.close();

  check(problems.length === 0, `no console errors${problems.length ? `: ${problems.join(' | ')}` : ''}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
