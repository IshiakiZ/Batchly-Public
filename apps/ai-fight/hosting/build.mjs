import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {adaptOriginalPublic} from './public-adapter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const original = path.resolve(process.argv[2] || 'D:/AI Fight');
const output = path.resolve(process.argv[3] || path.join(here, '../artifacts/original-ui-r3/web'));
const includeAudio = process.argv.includes('--authorized-host-audio');
if (fs.existsSync(output)) throw new Error('Choose a fresh r3 candidate directory');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const originals = [], packaged = [];
const sources = {};
function put(name, bytes) {
  const target = path.join(output, name);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.writeFileSync(target, bytes, {flag:'wx'});
  packaged.push({path:name,bytes:Buffer.byteLength(bytes),sha256:hash(bytes)});
}
function walk(relative) {
  for (const item of fs.readdirSync(path.join(original, relative), {withFileTypes:true})) {
    const name = relative + '/' + item.name;
    if (item.isSymbolicLink()) throw new Error('Source symlinks are refused');
    if (item.isDirectory()) { if (includeAudio || name !== 'public/audio') walk(name); continue; }
    const bytes = fs.readFileSync(path.join(original, name));
    originals.push({path:name,bytes:bytes.length,sha256:hash(bytes)});
    if (name.startsWith('engine/')) { if (/\.(js|json)$/.test(name)) sources[name] = bytes.toString('utf8'); continue; }
    if (!name.startsWith('public/')) continue;
    const transformed=adaptOriginalPublic(name,bytes);
    put(name.slice(7), transformed);
  }
}
walk('engine');
walk('public');
for (const name of ['server.js','config.json','AI_GUIDE.md','ARMY_GUIDE.md','WAR_GUIDE.md','BUSINESS_GUIDE.md']) {
  const bytes = fs.readFileSync(path.join(original,name));
  sources[name] = bytes.toString('utf8');
  originals.push({path:name,bytes:bytes.length,sha256:hash(bytes)});
  if (name.endsWith('.md')) put(name,bytes);
}
const runtime = fs.readFileSync(path.join(here,'runtime.cjs'),'utf8');
put('original-server-worker.js', 'const ORIGINAL_SOURCES = '+JSON.stringify(sources)+';\n'+runtime+'\n'+fs.readFileSync(path.join(here,'server-worker.cjs'),'utf8'));
put('original-sim-worker.js', 'const ORIGINAL_SOURCES = '+JSON.stringify(sources)+';\n'+runtime+'\n'+fs.readFileSync(path.join(here,'sim-worker.cjs'),'utf8'));
put('original-validation-worker.js', 'const ORIGINAL_SOURCES = '+JSON.stringify(sources)+';\n'+runtime+'\n'+fs.readFileSync(path.join(here,'validation-worker.cjs'),'utf8'));
for (const name of ['adapter-entry.js','transport.js','isolation.js','storage-bridge.js','session-binding.js','pace-sync.js']) put(name,fs.readFileSync(path.join(here,name)));
put('host-bridge.js',fs.readFileSync(path.join(here,'host-bridge.js')));
put('original-ui-manifest.json',JSON.stringify({edition:'original-ui-r3-candidate',includeAudio,originals,packaged},null,2)+'\n');
console.log(JSON.stringify({output,files:packaged.length,originalFiles:originals.length,includeAudio}));
