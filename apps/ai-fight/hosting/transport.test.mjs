import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {stable,snapshotFromFiles,sameSnapshot,sessionStillMatches} from './session-binding.js';
import * as pace from './pace-sync.js';

const filesA={'fighter.json':'{ "name": "A" }','brain.js':'function brain(){return {move:1}}'};
const filesB={'fighter.json':'{"name":"B"}','brain.js':'function brain(){return {move:0}}'};
const session={id:'session-a',mode:'fighter',round:1,revision:4,phase:'ready',ready:[true,true],builds:[filesA,filesB]};
const state={matchId:'original-match-a',round:1,phase:'round_over'};
const target={id:session.id,round:1,revision:4,generation:0,matchId:state.matchId,buildKey:stable(session.builds)};
function harness(hostRequest,validation=async()=>({check:{ok:true,errors:[],warnings:[]}})){
  const sent=[];
  const worker={send(message){sent.push(message);},close(){}};
  const context=vm.createContext({URL,URLSearchParams,crypto:webcrypto,console,setTimeout,clearTimeout,TextEncoder,Response,EventTarget,MessageEvent,Event,
    location:{href:'https://batch-ly.com/ext/ai-fight-r3/index.html?session=session-a'},fetch:()=>{},
    stable,snapshotFromFiles,sameSnapshot,sessionStillMatches,...pace,hostRequest,runOriginalValidation:validation,
    originalToast(){},validateSnapshot(){},storageRequest(){},loadSavedFiles(){},
  });
  const code=fs.readFileSync(new URL('./transport.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',"'https://batch-ly.com/ext/ai-fight-r3/transport.js'").replace('export async function','async function');
  vm.runInContext(code+`\nglobalThis.h={set(s,g=0,b=null){session=s;sessionId=s.id;sessionReceivedAt=Date.now();generation=g;completionBinding=b;localState=${JSON.stringify(state)};},boot(w){worker=w;resolveBoot();},get:()=>session,adoptSession,syncAccountSession,mirrorClockControl,processQueuedChecks,checksInFlight,checkResults,adaptBootstrap,ensureHostReady,publishCompletion,pending};`,context);
  context.h.boot(worker);
  function reply(message=sent.at(-1),value={}){
    const request=context.h.pending.get(message.id);assert.ok(request,'pending response');
    clearTimeout(request.timer);context.h.pending.delete(message.id);request.resolve(value);
  }
  return {h:context.h,sent,reply};
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

const clock={enabled:true,started:true,paused:false,expired:false,server_now_ms:100000,deadline_ms:160000,remaining_ms:60000,limit_ms:60000,started_at_ms:100000};
const building={...session,phase:'building',ready:[false,false],clock,clock_settings:{first_round_seconds:60,round_seconds:300},activity:[null,null],checks:[null,null]};
const queued={...building,checks:[{id:'check-a',status:'queued',round:1,build_revision:4,build_hash:'source-a'},null]};
async function finishSync(harness,promise){
  await turn();harness.reply();await promise;
}
test('same revision clock updates use source-free status without repeated full sync',async()=>{
  const q=harness();q.h.set(building);
  await finishSync(q,q.h.syncAccountSession());
  assert.equal(q.sent[0].type,'session');
  q.h.adoptSession({...building,clock:{...clock,server_now_ms:104000,remaining_ms:56000}},session.id);
  await finishSync(q,q.h.syncAccountSession());
  assert.equal(q.sent[1].type,'session-status');assert.equal('builds' in q.sent[1].session,false);
  q.h.adoptSession({...building,clock:{...clock,server_now_ms:108000,paused:true,remaining_ms:55000}},session.id);
  await finishSync(q,q.h.syncAccountSession());
  assert.equal(q.sent[2].type,'session-status');
  assert.equal(q.h.adoptSession({...building,clock:{...clock,server_now_ms:106000}},session.id),false);
  assert.equal(q.h.get().clock.paused,true);
});
test('clock commands use round guard, no build revision, and mirror only confirmed state',async()=>{
  const calls=[];const paused={...building,clock:{...clock,paused:true}};
  const q=harness(async(action,args)=>{calls.push({action,args});return paused;});q.h.set(building);
  const promise=q.h.mirrorClockControl('clock-pause');await turn();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{action:'clock',args:{session_id:session.id,expected_round:1,command:'pause',settings:{}}});
  q.reply();await turn();assert.equal(q.sent[1].type,'session-status');assert.equal(q.sent[1].control,'pause');q.reply();await promise;
  assert.equal(q.h.get().clock.paused,true);
});
test('settings remain available after building and errors never mutate local clock',async()=>{
  const calls=[];const complete={...building,phase:'round_over'};
  const q=harness(async(action,args)=>{calls.push({action,args});throw new Error('Clock update refused');});q.h.set(complete);
  await assert.rejects(q.h.mirrorClockControl('settings',{firstRoundLimitSec:0,roundLimitSec:700}),/refused/);
  assert.equal(calls[0].args.settings.first_round_seconds,0);assert.equal(calls[0].args.settings.round_seconds,700);
  assert.equal(q.sent.length,0);assert.equal(q.h.get().clock.limit_ms,60000);
});
test('late clock response cannot affect a replacement match',async()=>{
  let answer;const q=harness(()=>new Promise(resolve=>{answer=resolve;}));q.h.set(building);
  const promise=q.h.mirrorClockControl('clock-add');
  q.h.set({...building,id:'session-b'},1);answer(building);
  await assert.rejects(promise,/match changed/);assert.equal(q.sent.length,0);
});
test('one disposable check per job, then report with exact job and round',async()=>{
  let finishValidation,count=0;const calls=[];
  const q=harness(async(action,args)=>{
    calls.push({action,args});
    return action==='get'?queued:{...queued,checks:[{...queued.checks[0],status:'completed',result:args.result},null]};
  },()=>{count++;return new Promise(resolve=>{finishValidation=resolve;});});
  q.h.set(queued);q.h.processQueuedChecks();q.h.processQueuedChecks();assert.equal(count,1);
  finishValidation({check:{ok:true,errors:[],warnings:[]}});await turn();
  assert.equal(calls[1].action,'check_result');assert.equal(calls[1].args.check_id,'check-a');
  assert.equal(calls[1].args.expected_round,1);assert.equal('expected_revision' in calls[1].args,false);
  q.reply();await Promise.all(q.h.checksInFlight.values());
  q.h.processQueuedChecks();assert.equal(count,1);assert.equal(q.h.get().ready[0],false);
});
for(const change of ['round','session','source'])test('queued check discards result after '+change+' change',async()=>{
  let finish;const calls=[];
  const q=harness(async(action,args)=>{calls.push({action,args});return queued;},()=>new Promise(resolve=>{finish=resolve;}));q.h.set(queued);q.h.processQueuedChecks();
  const current=change==='round'?{...queued,round:2}:change==='session'?{...queued,id:'session-b'}:{...queued,builds:[{...filesA,'brain.js':'changed'},filesB]};
  q.h.set(current,change==='source'?0:1);finish({check:{ok:true,errors:[],warnings:[]}});
  await Promise.all(q.h.checksInFlight.values());assert.equal(calls.length,0);assert.equal(q.sent.length,0);
});
test('failed check report retries cached timeout result without another worker',async()=>{
  let validations=0,reports=0;
  const q=harness(async(action,args)=>{if(action==='get')return queued;reports++;if(reports===1)throw new Error('Temporary host error');return {...queued,checks:[{...queued.checks[0],status:'completed',result:args.result},null]};},
    async()=>{validations++;throw new Error('Brain validation timed out. Its Worker was terminated.');});
  q.h.set(queued);q.h.processQueuedChecks();await Promise.all(q.h.checksInFlight.values());
  q.h.processQueuedChecks();await turn();q.reply();await Promise.all(q.h.checksInFlight.values());
  assert.equal(validations,1);assert.equal(reports,2);assert.match(q.h.get().checks[0].result.errors[0],/timed out/);
});
test('auto-lock job is rebuilt if a newer pause kept the account clock alive',async()=>{
  const q=harness(async()=>({...building,clock:{...clock,paused:true}}));q.h.set(building);
  await finishSync(q,q.h.syncAccountSession());
  const promise=q.h.ensureHostReady({round:1,snapshots:session.builds.map(f=>snapshotFromFiles('fighter',f))},state.matchId,0,true);
  await turn();assert.equal(q.sent.at(-1).type,'session');assert.equal(q.sent.at(-1).restart,true);q.reply();
  await assert.rejects(promise,error=>error.superseded===true);
});
test('auto-lock at the confirmed deadline uses original locks with exact ready bytes',async()=>{
  const expired={...building,ready:[true,false],clock:{...clock,expired:true}};
  const calls=[];const q=harness(async(action,args)=>{calls.push({action,args});return action==='get'?expired:session;});q.h.set(expired);
  await finishSync(q,q.h.syncAccountSession());
  const promise=q.h.ensureHostReady({round:1,snapshots:session.builds.map(f=>snapshotFromFiles('fighter',f))},state.matchId,0,true);
  await turn();q.reply(q.sent.at(-1),[{...filesA,'fighter.json':'{"name":"A"}'},filesB]);await promise;
  assert.equal(calls.at(-1).action,'force_start');assert.equal(calls.at(-1).args.files[0]['fighter.json'],filesA['fighter.json']);
});
test('MCP prompts start directly, fetch selected rules once, and use compact create',()=>{
  const q=harness();q.h.set(building);
  const data={config:{fighters:[{id:'claude',label:'Claude'},{id:'chatgpt',label:'ChatGPT'}]},state:{round:3},mode:{id:'fighter',name:'Fighter'},prompts:{}};
  const prompt=q.h.adaptBootstrap(data).prompts.claude;
  assert.match(prompt,/ai_fight_begin_turn NOW/);assert.match(prompt,/expected_round:3/);
  assert.match(prompt,/ai_fight_get_rules once/);assert.match(prompt,/ai_fight_patch_build/);
  assert.match(prompt,/90-150/);assert.doesNotMatch(prompt,/node arena\.js/);
  assert.match(prompt,/remove:\[\]/);assert.match(prompt,/max_seconds:20/);assert.match(prompt,/Once ready or clock.expired, STOP EDITING/);
  q.h.set({...building,id:null});assert.match(q.h.adaptBootstrap(data).prompts.claude,/compact:true/);
});
