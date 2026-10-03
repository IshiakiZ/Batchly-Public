import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {stable,snapshotFromFiles,sameSnapshot,sessionStillMatches} from './session-binding.js';

const filesA={'fighter.json':'{ "name": "A" }','brain.js':'function brain(){return {move:1}}'};
const filesB={'fighter.json':'{"name":"B"}','brain.js':'function brain(){return {move:0}}'};
const session={id:'session-a',mode:'fighter',round:1,revision:4,phase:'ready',ready:[true,true],builds:[filesA,filesB]};
const state={matchId:'original-match-a',round:1,phase:'round_over'};
const target={id:session.id,round:1,revision:4,generation:0,matchId:state.matchId,buildKey:stable(session.builds)};
function harness(hostRequest){
  const sent=[];
  const worker={send(message){sent.push(message);},close(){}};
  const context=vm.createContext({URL,URLSearchParams,crypto:webcrypto,console,setTimeout,clearTimeout,TextEncoder,Response,EventTarget,MessageEvent,Event,
    location:{href:'https://batch-ly.com/ext/ai-fight-r2/index.html?session=session-a'},fetch:()=>{},
    stable,snapshotFromFiles,sameSnapshot,sessionStillMatches,hostRequest,
    originalToast(){},validateSnapshot(){},storageRequest(){},loadSavedFiles(){},
  });
  const code=fs.readFileSync(new URL('./transport.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',"'https://batch-ly.com/ext/ai-fight-r2/transport.js'").replace('export async function','async function');
  vm.runInContext(code+`\nglobalThis.h={set(s,g=0,b=null){session=s;sessionId=s.id;generation=g;completionBinding=b;localState=${JSON.stringify(state)};},boot(w){worker=w;resolveBoot();},ensureHostReady,publishCompletion,pending};`,context);
  context.h.boot(worker);
  return {h:context.h,sent};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('confirmed ready snapshots bind session, round and revision',async()=>{
  const {h}=harness(async()=>session);h.set(session);
  const result=await h.ensureHostReady({round:1,snapshots:session.builds.map(f=>snapshotFromFiles('fighter',f))},state.matchId,0);
  assert.equal(result.revision,4);assert.equal(result.buildKey,stable(session.builds));
});
test('an agent locking newer files causes the original job to be rebuilt',async()=>{
  const {h,sent}=harness(async()=>session);h.set({...session,phase:'building',revision:1});
  const promise=h.ensureHostReady({round:1,snapshots:[snapshotFromFiles('fighter',{...filesA,'brain.js':'function brain(){return {}}'}),snapshotFromFiles('fighter',filesB)]},state.matchId,0);
  await turn();assert.equal(sent[0].type,'session');assert.equal(sent[0].restart,true);
  h.pending.get(sent[0].id).resolve({});clearTimeout(h.pending.get(sent[0].id).timer);h.pending.delete(sent[0].id);
  await assert.rejects(promise,error=>error.superseded===true);
});
test('force start preserves exact strings of the already-ready side',async()=>{
  const calls=[];const building={...session,phase:'building',ready:[true,false]};
  const {h,sent}=harness(async(action,args)=>{calls.push({action,args});return action==='get'?building:session;});h.set(building);
  const promise=h.ensureHostReady({round:1,snapshots:session.builds.map(f=>snapshotFromFiles('fighter',f))},state.matchId,0);
  await turn();const pending=h.pending.get(sent[0].id);clearTimeout(pending.timer);h.pending.delete(sent[0].id);
  pending.resolve([{...filesA,'fighter.json':'{"name":"A"}'},filesB]);await promise;
  assert.equal(calls[1].args.files[0]['fighter.json'],filesA['fighter.json']);
});
for(const change of ['new match','new round'])test('pending completion is discarded after '+change,async()=>{
  const calls=[];const {h,sent}=harness(async(action,args)=>{calls.push({action,args});return session;});h.set(session,0,target);
  const promise=h.publishCompletion(state);await turn();
  h.set(change==='new match'?{...session,id:'session-b'}:{...session,round:2},1,null);
  const pending=h.pending.get(sent[0].id);clearTimeout(pending.timer);h.pending.delete(sent[0].id);
  pending.resolve({body:JSON.stringify({result:{winner:0}})});await promise;assert.equal(calls.length,0);
});
test('unchanged completion uses its captured target and marks result unranked',async()=>{
  const calls=[];const {h,sent}=harness(async(action,args)=>{calls.push({action,args});return {...session,phase:'round_over',revision:5};});h.set(session,0,target);
  const promise=h.publishCompletion(state);await turn();const pending=h.pending.get(sent[0].id);clearTimeout(pending.timer);h.pending.delete(sent[0].id);
  pending.resolve({body:JSON.stringify({result:{winner:0}})});await promise;
  assert.equal(calls[0].args.session_id,'session-a');assert.equal(calls[0].args.expected_revision,4);assert.equal(calls[0].args.result.unranked,true);
});
test('persistent runtime refuses executable brain contexts',()=>{
  const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,DataView,performance,crypto:webcrypto,setTimeout});
  vm.runInContext(fs.readFileSync(new URL('./runtime.cjs',import.meta.url),'utf8')+`\nglobalThis.environment=originalEnvironment({}, {noBrainExecution:true});`,context);
  const runtime=context.environment.load('vm');const script=new runtime.Script('function brain(){return {}}');
  assert.throws(()=>script.runInContext(runtime.createContext({})),/forbidden in the persistent server/);
});
test('storage load retries only the explicit auth hydration error, with a bound',async()=>{
  let attempts=0;
  const source=fs.readFileSync(new URL('./storage-bridge.js',import.meta.url),'utf8');
  const loadFunction=source.slice(source.indexOf('export async function loadSavedFiles')).replace('export ','');
  const context=vm.createContext({setTimeout:fn=>fn(),storageRequest:async()=>{attempts++;throw new Error('Account status is still loading. Try history load again.');}});
  vm.runInContext(loadFunction+';globalThis.load=loadSavedFiles;',context);
  await assert.rejects(context.load(),/still loading/);assert.equal(attempts,8);
  attempts=0;context.storageRequest=async()=>{attempts++;throw new Error('Saved history could not be read');};
  await assert.rejects(context.load(),/could not be read/);assert.equal(attempts,1);
});
