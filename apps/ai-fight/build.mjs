import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const ROOT_FILES = new Set([
  'server.js', 'arena.js', 'config.json', 'package.json', 'README.md', 'start.bat',
  'AI_GUIDE.md', 'ARMY_GUIDE.md', 'WAR_GUIDE.md', 'BUSINESS_GUIDE.md',
]);

export function allowedInput(relative) {
  if (typeof relative !== 'string' || relative.includes('\\') ||
      relative.split('/').some(part => !part || part === '.' || part === '..') ||
      relative.includes(':')) return false;
  if (ROOT_FILES.has(relative)) return true;
  if (relative.startsWith('engine/modes/tug/')) return false;
  if (relative.startsWith('engine/')) return /\.(js|json|md|tpl)$/.test(relative);
  if (relative === 'public/index.html' || relative === 'public/favicon.svg') return true;
  if (relative === 'public/js/sound.js' || relative.startsWith('public/js/modes/tug/')) return false;
  return /^public\/(js\/.*\.js|css\/[^/]+\.css)$/.test(relative);
}

export function readRegular(root, relative) {
  const absoluteRoot = path.resolve(root);
  let current = absoluteRoot;
  // Reject links at every component so an allowlisted filename cannot export a
  // private file through a symlink or Windows junction.
  for (const part of ['.', ...relative.split('/')]) {
    current = path.resolve(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Linked input refused: ${relative}`);
  }
  if (!fs.statSync(current).isFile()) throw new Error(`Not a regular file: ${relative}`);
  return fs.readFileSync(current);
}

export function assertClean(relative, text) {
  const patterns = [
    /\b(?:bmcp_|ghp_|github_pat_|sk_live_|sk-proj-)[A-Za-z0-9_-]{20,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/,
    /(?:postgres(?:ql)?|mysql):\/\/[^\s]+:[^\s]+@/i,
    /(?:api[_-]?key|password|secret|token)\s*[:=]\s*['"][A-Za-z0-9_+/=-]{24,}['"]/i,
    /[A-Za-z]:[\\/]Users[\\/][^\s'"<>]+/i,
  ];
  if (text.includes('\0') || patterns.some(pattern => pattern.test(text))) {
    // Report only the path, never the matching credential.
    throw new Error(`Private, credential-like or binary content refused: ${relative}`);
  }
}

function replaceRequired(text, before, after, relative) {
  if (!text.includes(before)) throw new Error(`Sanitizer needs review: ${relative}`);
  return text.replace(before, after);
}

export function sanitize(relative, input) {
  let text = input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (relative === 'public/index.html') {
    text = text.replace(/^.*<link[^\n]*https:\/\/fonts\.[^\n]*\n/gm, '');
  }
  if (relative === 'public/css/style.css') {
    text = text.replace(/\/\* Pixelify Sans[\s\S]*?\*\//, '/* This edition uses only fonts already installed on the device. */');
    text = text.replace(/^@font-face[^\n]*\n/gm, '');
    text = text.replace(/^\s*--display:.*$/m, "  --display: 'Courier New', monospace;");
    text = text.replace(/^\s*--body:.*$/m, "  --body: 'Segoe UI', system-ui, sans-serif;");
    text = text.replace(/^\s*--mono:.*$/m, "  --mono: 'Consolas', monospace;");
  }
  if (relative === 'public/js/app.js') {
    text = replaceRequired(text, "b.title = isMuted() ? 'Sound is off (M)' : 'Sound is on (M)';",
      "b.title = 'Silent edition: audio is not included';\n  b.disabled = true;", relative);
    text = replaceRequired(text, "vol.addEventListener('change', () => sfx.hit(40));",
      "vol.addEventListener('change', () => sfx.hit(40));\n  sound.disabled = true;\n  music.disabled = true;\n  vol.disabled = true;", relative);
    text = replaceRequired(text, 'Music and most sound effects are from Epidemic Sound (public/audio/CREDITS.md).',
      'Silent edition. Music, sound effects and bundled fonts are not included.', relative);
    text = replaceRequired(text, "toast(isMuted() ? 'Sound off' : 'Sound on');",
      "toast('Silent edition: audio is not included');", relative);
  }
  if (relative === 'package.json') {
    const pkg = JSON.parse(text);
    pkg.name = 'ai-fight-silent-source';
    pkg.description = 'Trusted local AI arena. Silent source edition; no hosted MCP gameplay.';
    pkg.private = true;
    pkg.license = 'UNLICENSED';
    text = JSON.stringify(pkg, null, 2) + '\n';
  }
  if (relative === 'README.md') {
    text = text.replace(/^Music and most sound effects.*\n?/m, 'This source edition contains no audio files or bundled fonts.\n');
    text = text.replace('public/audio: music + sounds, see CREDITS.md', 'procedural spectator artwork; silent edition');
    text = text.replace('Brains run inside a\ntime-limited sandbox with no access to files or the network, and fights are deterministic\nand replayable.',
      'Brains run in time-limited Node VM contexts. Only run code from trusted local agents;\nNode VM is not a security boundary for untrusted code. Fights are deterministic and replayable.');
  }
  return text;
}

export function build({ source, output, inputs = JSON.parse(fs.readFileSync(path.join(ROOT, 'source-inputs.json'), 'utf8')) }) {
  const sourceRoot = path.resolve(source);
  const outputRoot = path.resolve(output);
  const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
  if (inside(sourceRoot, outputRoot) || inside(outputRoot, sourceRoot)) throw new Error('Source and output must not overlap');
  if (fs.existsSync(outputRoot)) throw new Error('Output already exists; choose a fresh output directory');
  const files = new Map();
  const provenance = new Map();
  for (const entry of inputs) {
    if (!allowedInput(entry.path) || files.has(entry.path)) throw new Error(`Input not allowed or duplicated: ${entry.path}`);
    const bytes = readRegular(sourceRoot, entry.path);
    if (sha256(bytes) !== entry.sha256) throw new Error(`Source changed; review before exporting: ${entry.path}`);
    const target = entry.path === 'README.md' ? 'LOCAL-GUIDE.md' : entry.path;
    const text = sanitize(entry.path, bytes.toString('utf8'));
    assertClean(target, text);
    files.set(target, text);
    provenance.set(target, { originalPath: entry.path, originalSha256: entry.sha256 });
  }
  files.set('public/js/sound.js', fs.readFileSync(path.join(ROOT, 'silent-audio.mjs'), 'utf8'));
  for (const name of ['README.md', 'LICENSE-NOTICE.md', 'SECURITY.md']) {
    files.set(name, fs.readFileSync(path.join(ROOT, 'package-docs', name), 'utf8'));
  }
  files.set('.gitignore', 'data/\nfighters/\nresults/\nprompts/\nnode_modules/\n.env\n.env.*\n*.pem\n*.key\npublic/audio/\npublic/fonts/\n');
  const manifest = {
    schema: 1,
    edition: 'silent-trusted-local-source',
    publication: 'Owner authorized public source preparation; no repository has been created or pushed.',
    codeLicense: 'No open-source license selected. No new license grant is made by this package.',
    included: 'Owner-authorized source and procedural artwork, plus source-preparation changes.',
    excluded: ['public/audio/**', 'public/fonts/**', 'tools/fonts/**', 'fighters/**', 'data/**', 'results/**', 'prompts/**', '.git/**', '.env*', 'engine/modes/tug/**', 'public/js/modes/tug/**'],
    assets: [
      { kind: 'Audio', included: false, reason: 'Owner requested exclusion; source credits identify account-licensed recordings.' },
      { kind: 'Fonts', included: false, reason: 'Bundled fonts and external font links removed; use installed system fonts.' },
      { kind: 'Canvas and SVG artwork', included: true, reason: 'Procedural source and favicon from the owner-authorized application; no imported image files.' },
    ],
    files: [...files].sort(([a], [b]) => a.localeCompare(b)).map(([relative, text]) => ({
      path: relative, bytes: Buffer.byteLength(text), sha256: sha256(text),
      ...(provenance.get(relative) || { originalPath: null, originalSha256: null }),
      classification: provenance.has(relative) ? 'owner-authorized-source' : 'preparation-source',
    })),
  };
  files.set('LICENSE-MANIFEST.json', JSON.stringify(manifest, null, 2) + '\n');
  for (const [relative, text] of files) assertClean(relative, text);
  fs.mkdirSync(outputRoot, { recursive: true });
  for (const [relative, text] of files) {
    const destination = path.join(outputRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, text, { flag: 'wx' });
  }
  return { output: outputRoot, files: files.size, bytes: [...files.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = process.argv[2] || 'D:/AI Fight';
  const output = process.argv[3] || path.join(ROOT, 'artifacts', 'source');
  console.log(JSON.stringify(build({ source, output }), null, 2));
}
