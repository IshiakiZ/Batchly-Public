import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readRegular, sha256, assertClean } from './build.mjs';
const source = process.argv[2] || 'D:/AI Fight';
const output = path.resolve(process.argv[3] || path.join(ROOT, 'artifacts/web'));
if (fs.existsSync(output)) throw new Error('Choose a new output directory; existing artifacts are preserved');
const inputs = JSON.parse(fs.readFileSync(path.join(ROOT, 'source-inputs.json'), 'utf8').replace(/^\uFEFF/, ''));
const files = new Map();
const modules = {};
for (const entry of inputs) {
  const bytes = readRegular(source, entry.path);
  if (sha256(bytes) !== entry.sha256) throw new Error(`Source changed: ${entry.path}`);
  const text = bytes.toString('utf8');
  assertClean(entry.path, text);
  if (entry.path.startsWith('engine/')) modules[entry.path] = text;
  // The portable client replaces the local server UI; only reuse renderer modules.
  if (/^public\/js\/(?:art-[^/]+\.js|renderer\.js|sprites\.js|util\.js|modes\/[^/]+\/(?:view|sprites)\.js)$/.test(entry.path)) files.set(entry.path.slice(7), text);
  if (entry.path === 'public/favicon.svg') files.set('favicon.svg', text);
  if (/^[A-Z_]+GUIDE\.md$/.test(entry.path)) files.set('guides/' + entry.path, text);
}
files.set('js/sound.js', fs.readFileSync(path.join(ROOT, 'silent-audio.mjs'), 'utf8'));
for (const name of ['index.html', 'app.css', 'client.js', 'runner.js', 'host-bridge.js']) files.set(name, fs.readFileSync(path.join(ROOT, 'browser', name), 'utf8'));
files.set('engine-worker.js', fs.readFileSync(path.join(ROOT, 'browser/runtime.cjs'), 'utf8') + '\nconst ENGINE_SOURCES = ' + JSON.stringify(modules) + ';\n' + fs.readFileSync(path.join(ROOT, 'browser/worker.cjs'), 'utf8'));
files.set('LICENSE-NOTICE.md', fs.readFileSync(path.join(ROOT, 'package-docs/LICENSE-NOTICE.md'), 'utf8'));
const manifest = [...files].map(([name, text]) => ({ path: name, bytes: Buffer.byteLength(text), sha256: sha256(text) }));
files.set('web-manifest.json', JSON.stringify({ edition: 'four-original-engines-browser-worker', files: manifest }, null, 2));
for (const [relative, text] of files) {
  const destination = path.join(output, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, text, { flag: 'wx' });
}
console.log(JSON.stringify({ output, files: files.size, engineModules: Object.keys(modules).length, workerBytes: Buffer.byteLength(files.get('engine-worker.js')) }));
