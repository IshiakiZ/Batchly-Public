import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeSlug, checkText, readCatalog, sync } from './sync.mjs';

test('rejects unsafe catalog paths', () => {
 for (const slug of ['../app','app/name','UPPER','-app']) assert.throws(() => safeSlug(slug));
 assert.equal(safeSlug('afterloop-4s2m'),'afterloop-4s2m');
});

test('rejects credential patterns without echoing values, permits anonymous public JWT', () => {
  const jwt = claims => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.abcdef';
  assert.doesNotThrow(() => checkText(jwt({role:'anon'}), 'public.html'));
  for (const value of [jwt({role:'service_role'}),jwt({role:'authenticated',sub:'person'}),'ghp_'+'A'.repeat(36)]) assert.throws(() => checkText(value,'game.html'), e => !e.message.includes(value));
});

const admin = {kind:'admin',table:'custom_games',select:'id,slug,visibility',filter:'&visibility=eq.public'};
const response = value => new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('paginates and checks row publication rather than trusting the endpoint alone', async () => {
  const requests = [];
  const rows = Array.from({length:41},(_,i)=>({id:String(i),slug:'game-'+i,visibility:'public'}));
  const result = await readCatalog(admin,async url => { requests.push(url); const n=Number(new URL(url).searchParams.get('offset')); return response(rows.slice(n,n+40)); });
  assert.equal(result.length,41); assert.equal(requests.length,2);
  await assert.rejects(readCatalog(admin,async()=>response([{...rows[0],visibility:'debug'}])));
  await assert.rejects(readCatalog({...admin,kind:'community'},async()=>response([rows[0]])));
  await assert.rejects(readCatalog(admin,async()=>response([])));
});

test('failed or redirected downloads retain the previous mirror', async () => {
  const root=await mkdtemp(join(tmpdir(),'batchly-mirror-'));
  try {
    await mkdir(join(root,'catalog')); await writeFile(join(root,'catalog','keep.txt'),'existing public snapshot');
    await assert.rejects(sync(root,async()=>new Response('',{status:503}), {}));
    assert.equal(await readFile(join(root,'catalog','keep.txt'),'utf8'),'existing public snapshot');
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('exports explicit metadata, not extra account fields, and never executes HTML', async () => {
  const root=await mkdtemp(join(tmpdir(),'batchly-mirror-'));
  const html='<script>throw new Error("must never execute")</script>';
  const fetcher=async url => response([{id:'1',slug:'safe',title:'A game',description:'Public',visibility:'public',published_at:'2026-09-18',html_content:html,game_type:'html',created_by:'PRIVATE',email:'PRIVATE',python_assets:[]}]);
  try {
    const sha=createHash('sha256').update(html).digest('hex');
    await sync(root,fetcher,{'admin/safe':{'index.html':sha},'community/safe':{'index.html':sha}});
    assert.equal(await readFile(join(root,'catalog/admin/safe/index.html'),'utf8'),html);
    assert.ok(!(await readFile(join(root,'catalog/index.json'),'utf8')).includes('PRIVATE'));
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('new apps and changed versions cannot publish without reviewed hashes', async () => {
 const root=await mkdtemp(join(tmpdir(),'batchly-review-'));
 try {
 const fetcher=async()=>response([{id:'1',slug:'unreviewed',visibility:'public',published_at:'2026-09-18',html_content:'licensed content',game_type:'html'}]);
 const games=await sync(root,fetcher,{'admin/unreviewed':{'index.html':'old-reviewed-hash'}});
 assert.equal(games.length,0);
 assert.equal(JSON.parse(await readFile(join(root,'catalog/index.json'),'utf8')).awaitingRightsReview,2);
 } finally {await rm(root,{recursive:true,force:true});}
});
