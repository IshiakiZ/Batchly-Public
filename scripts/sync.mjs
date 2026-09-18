import { mkdir, writeFile, readFile, rename, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// This is the site's public browser key, not an account or service credential.
const API = 'https://api.batch-ly.com';
const PUBLIC_KEY = 'sb_publishable_n7ZExT-w2Tg7TmaZzH5AzQ_5xZ8Ujt2';
const PAGE = 40;
const MAX_FILE = 45 * 1024 * 1024;
const MAX_TOTAL = 300 * 1024 * 1024;
const common = 'id,slug,title,description,html_content,game_type,python_code,python_deps,python_mode';
const sources = [
  { kind: 'admin', table: 'custom_games', select: common + ',visibility,python_assets,python_runtime', filter: '&visibility=eq.public' },
  { kind: 'community', table: 'live_community_games', select: common + ',author_name,published_at,cover_url', filter: '' },
];

export function safeSlug(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(value)) throw new Error('Invalid catalog slug');
  return value;
}

export function checkText(text, label) {
  // Fail without printing a suspected secret. Being public once is not permission to spread credentials.
  const patterns = [ /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sb_secret_[A-Za-z0-9_-]{20,}|bmcp_[A-Za-z0-9_-]{25,}|AKIA[0-9A-Z]{16})\b/, /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}\b/ ];
  if (patterns.some(p => p.test(text))) throw new Error('Possible credential in ' + label);
  for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
    let claims;
    try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { throw new Error('Unrecognized JWT in ' + label); }
    if (claims.role !== 'anon' || claims.sub || claims.email) throw new Error('Non-public JWT in ' + label);
  }
}

async function download(url, fetcher, headers = {}, limit = MAX_FILE) {
  const response = await fetcher(url, { headers, redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('Public fetch failed: HTTP ' + response.status);
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Public file exceeds size limit');
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw new Error('Public response exceeds size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readCatalog(source, fetcher = fetch) {
  const all = []; const seen = new Set();
  for (let offset = 0; offset < 10000; offset += PAGE) {
    const url = `${API}/rest/v1/${source.table}?select=${source.select}${source.filter}&order=id.asc&limit=${PAGE}&offset=${offset}`;
    const rows = JSON.parse((await download(url, fetcher, { apikey: PUBLIC_KEY })).toString());
    if (!Array.isArray(rows)) throw new Error('Invalid catalog response');
    for (const row of rows) {
      safeSlug(row.slug);
      if (seen.has(row.id)) throw new Error('Catalog changed during pagination; retry later');
      seen.add(row.id);
      if (source.kind === 'admin' && row.visibility !== 'public') throw new Error('Non-public admin row refused');
      if (source.kind === 'community' && !row.published_at) throw new Error('Unpublished community row refused');
      all.push(row);
    }
    if (rows.length < PAGE) {
      if (!all.length) throw new Error('Empty catalog refused; previous mirror retained');
      return all;
    }
  }
  throw new Error('Catalog pagination limit reached');
}

const md = value => String(value ?? '').replace(/[\r\n|<>\[\]`]/g, ' ').replace(/\\/g, '').trim();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function sync(root, fetcher = fetch, approvedVersions) {
  root = resolve(root);
  const approved = approvedVersions ?? JSON.parse(await readFile(join(root, 'approved-games.json'), 'utf8'));
  const stage = join(root, '.mirror-staging');
  const target = join(root, 'catalog');
  // Only these tool-owned directories can be replaced. Never traverse a symlink.
  for (const dir of [stage, target, join(root, '.mirror-previous')]) {
    const info = await import('node:fs/promises').then(m => m.lstat(dir)).catch(e => { if (e.code !== 'ENOENT') throw e; });
    if (info?.isSymbolicLink()) throw new Error('Refusing a symlink output directory');
  }
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  let total = 0;
  let awaitingReview = 0;
  const memberships = new Map();
  const catalog = [];
  try {
    for (const source of sources) {
      const rows = await readCatalog(source, fetcher);
      memberships.set(source.kind, rows.map(r => source.kind + '/' + r.slug).sort());
      for (const row of rows.sort((a,b) => a.slug.localeCompare(b.slug))) {
        const folder = `${source.kind}/${row.slug}`;
        // Public availability is not redistribution permission. Only an explicitly
        // reviewed byte-for-byte version may be copied, including on future updates.
        const candidate = {};
        if (row.html_content) candidate['index.html'] = hash(Buffer.from(row.html_content));
        if (row.python_code) candidate['main.py'] = hash(Buffer.from(row.python_code));
        const approval = approved[folder];
        if (!approval || JSON.stringify(candidate) !== JSON.stringify(approval) || row.python_assets?.length) {
          awaitingReview++;
          continue;
        }
        const files = []; let omittedAssets = 0;
        const put = async (name, data, origin) => {
          const bytes = Buffer.from(data);
          if (bytes.length > MAX_FILE || (total += bytes.length) > MAX_TOTAL) throw new Error('Mirror size limit exceeded');
          if (/\.(?:html|js|mjs|css|json|webmanifest|py|txt|md|svg)$/i.test(name)) checkText(bytes.toString(), folder + '/' + name);
          const destination = join(stage, folder, name);
          await mkdir(resolve(destination, '..'), { recursive: true });
          await writeFile(destination, bytes);
          files.push({ path: name, bytes: bytes.length, sha256: hash(bytes), source: origin });
        };
        if (row.html_content) await put('index.html', row.html_content, 'published catalog HTML');
        if (row.python_code) await put('main.py', row.python_code, 'published catalog Python');
        if (!files.length) throw new Error('Published game has no source: ' + folder);
        const item = {
          folder, title: row.title, description: row.description,
          author: source.kind === 'community' ? row.author_name : 'Batchly catalog',
          play: `https://batch-ly.com/${source.kind === 'admin' ? 'play' : 'c'}/${row.slug}`,
          type: row.game_type, pythonDependencies: row.python_deps || [],
          pythonMode: row.python_mode || null, pythonRuntime: row.python_runtime || null,
          omittedDevelopmentOrUnsupportedAssets: omittedAssets, files,
        };
        checkText(JSON.stringify(item), folder + '/metadata.json');
        await writeFile(join(stage, folder, 'metadata.json'), JSON.stringify(item, null, 2) + '\n');
        catalog.push(item);
      }
    }
    // Recheck membership so a removal during a long download does not create a newly stale export.
    for (const source of sources) {
      const now = (await readCatalog(source, fetcher)).map(r => source.kind + '/' + r.slug).sort();
      const before = memberships.get(source.kind);
      if (JSON.stringify(now) !== JSON.stringify(before)) throw new Error('Publication changed during sync; retry later');
    }
    const index = { checkedOn: new Date().toISOString().slice(0,10), awaitingRightsReview: awaitingReview, games: catalog };
    await writeFile(join(stage, 'index.json'), JSON.stringify(index, null, 2) + '\n');
    await writeFile(join(stage, 'README.md'), '# Published game downloads\n\n' +
      `Checked ${index.checkedOn}. ${catalog.length} published games and apps. Download the repository ZIP from **Code > Download ZIP**, or open a file and choose **Download raw file**.\n\n` +
      'These are published files, not a promise that every game runs offline. See the [repository guide](../README.md).\n\n' +
      '| Game | Collection | Files | Play |\n| --- | --- | --- | --- |\n' +
      catalog.map(g => `| ${md(g.title)} | ${g.folder.split('/')[0]} | [Download files](${g.folder}/) | [Play](${g.play}) |`).join('\n') + '\n');
    const previous = join(root, '.mirror-previous');
    await rm(previous, { recursive: true, force: true });
    const existing = await stat(target).catch(e => { if (e.code !== 'ENOENT') throw e; });
    if (existing) await rename(target, previous);
    try { await rename(stage, target); } catch (error) { if (existing) await rename(previous, target); throw error; }
    await rm(previous, { recursive: true, force: true });
    console.log(JSON.stringify({ games: catalog.length, bytes: total, omittedAssets: catalog.reduce((n,g) => n + g.omittedDevelopmentOrUnsupportedAssets, 0) }));
    return catalog;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await sync(process.cwd());
}
