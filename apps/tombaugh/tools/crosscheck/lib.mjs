// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// tools/crosscheck/lib.mjs - shared helpers of the Node half of the Astropy cross-check.
//
// Every cN_*.mjs script runs OUR JavaScript on fixed inputs and writes what it got into the work
// directory: JSON for numbers that fit, raw little-endian binary for whole images (so that NaN
// and every bit of a float32 survive). The matching cN_*.py script computes the same thing with
// Astropy and compares. Nothing here imports Astropy's answers, and the Python side never
// imports ours, so the two halves stay independent.
//
// Work directory: $CROSSCHECK_OUT, default <repo>/tmp/crosscheck (git-ignored).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const OUT = path.resolve(process.env.CROSSCHECK_OUT || path.join(ROOT, 'tmp', 'crosscheck'));

fs.mkdirSync(OUT, { recursive: true });

export const outPath = (name) => path.join(OUT, name);

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export const CASES = readJson(path.join(HERE, 'cases.json')).synthetic;
export const REAL = readJson(path.join(HERE, 'real_header.json'));

/** Non-finite numbers become null (JSON has no NaN); the Python side maps null back to NaN. */
export function writeJson(name, value) {
  const text = JSON.stringify(value, (key, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v));
  fs.writeFileSync(outPath(name), text);
}

/** Raw bytes of a typed array, little-endian (this refuses to run on a big-endian host). */
export function writeRaw(name, array) {
  if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) throw new Error('crosscheck needs a little-endian host');
  fs.writeFileSync(outPath(name), new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
}

export function readBytes(name) {
  const b = fs.readFileSync(outPath(name));
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

/** The real header of CONTRACT.md as the Map that proxy/src/fits.js would produce. */
export function realHeaderMap() {
  return new Map(REAL.cards);
}

/** n evenly spaced numbers from a to b inclusive. */
export function linspace(a, b, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = n === 1 ? a : a + ((b - a) * i) / (n - 1);
  return out;
}

/** Deterministic uniform random numbers in [0, 1) (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function log(text) {
  process.stdout.write(`  [node] ${text}\n`);
}
