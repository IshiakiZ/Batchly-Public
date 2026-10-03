import test from 'node:test';
import assert from 'node:assert/strict';
import {originalWorkerHarness} from './worker-test-harness.mjs';
import {originalClockInfo,sessionStatus} from './pace-sync.js';

async function setup(mode='fighter'){
  const worker=await originalWorkerHarness();
  const session={id:'shared-a',mode,round:1,revision:1,phase:'building',builds:[null,null],ready:[false,false],
    clock_settings:{first_round_seconds:360,round_seconds:300},activity:[null,null],checks:[null,null],
    clock:{enabled:true,started:false,paused:false,expired:false,remaining_ms:360000,deadline_ms:null,server_now_ms:worker.now+120000,limit_ms:360000,started_at_ms:null}};
  async function sync(full=false,control){
    session.clock.server_now_ms=worker.now+120000;
    return worker.send({type:full?'session':'session-status',session:full?session:sessionStatus(session),reset:full,control,
      clockInfo:originalClockInfo(session.clock,worker.now,worker.now)});
  }
  await sync(true);return {worker,session,sync};
}
test('actual original worker mirrors clock, activity and checks without poll validation',async()=>{
  const {worker,session,sync}=await setup();const warmed=worker.validations;
  assert.equal(worker.state().clockInfo.started,false);
  session.activity[0]={message:'Working on spacing',at:new Date(session.clock.server_now_ms).toISOString()};
  await sync();const afterSay=worker.state();
  assert.equal(afterSay.activity.claude.says,1);assert.equal(afterSay.clockInfo.started,false);
  for(let i=0;i<3;i++){worker.advance(4000);await sync();}
  assert.equal(worker.validations,warmed);assert.equal(worker.state().activity.claude.says,1);
  session.clock={...session.clock,started:true,started_at_ms:worker.now+120000,deadline_ms:worker.now+180000,remaining_ms:60000,limit_ms:60000};
  await sync(false,'start');worker.advance(4000);
  assert.equal(worker.state().clockInfo.remainingMs,56000);
  session.clock={...session.clock,paused:true,remaining_ms:56000};
  await sync(false,'pause');worker.advance(8000);
  assert.equal(worker.state().clockInfo.remainingMs,56000);
  session.clock={...session.clock,remaining_ms:116000,limit_ms:120000,deadline_ms:worker.now+236000};
  await sync(false,'add');assert.equal(worker.state().clockInfo.remainingMs,116000);
  session.clock.paused=false;await sync(false,'resume');worker.advance(4000);
  assert.equal(worker.state().clockInfo.remainingMs,112000);
  session.checks[0]={id:'job-a',round:1,build_revision:1,build_hash:'hash',status:'queued'};
  await sync();await sync();assert.equal(worker.state().activity.claude.checks,1);
  session.checks[0]={...session.checks[0],status:'completed',result:{ok:true,errors:[],warnings:[]}};
  await sync();await sync();
  assert.equal(worker.validations,warmed);assert.equal(worker.state().activity.claude.checks,1);
  const feeds=worker.events.filter(e=>e.type==='sse'&&e.chunk.includes('Check passed'));
  assert.equal(feeds.length,1);
});
for(const mode of ['fighter','army','war','business'])test('original '+mode+' clock expiry locks starters once and settings remain usable',async()=>{
  const {worker,session,sync}=await setup(mode);
  const warmed=worker.validations;
  session.clock={...session.clock,started:true,started_at_ms:worker.now+120000,deadline_ms:worker.now+121000,remaining_ms:1000,limit_ms:1000};
  await sync();worker.advance(1001);
  const expired=worker.state();
  assert.equal(expired.phase,'countdown');
  assert.equal(expired.fighters.claude.ready,true);assert.equal(expired.fighters.chatgpt.ready,true);
  assert.equal(expired.clockInfo.expired,true);
  session.clock={...session.clock,expired:true,remaining_ms:0};
  session.clock_settings={first_round_seconds:20,round_seconds:900};
  await sync(false,'settings');assert.equal(worker.state().settings.roundLimitSec,900);
  assert.equal(worker.state().clockInfo.expired,true);assert.equal(worker.state().clock.limitMs,1000);
  worker.advance(1000);await sync();
  assert.equal(worker.validations,warmed);
  const lockFeeds=worker.events.filter(e=>e.type==='sse'&&e.chunk.includes('TIME\'S UP!'));
  assert.equal(lockFeeds.length,1);
});
test('same-revision stale clock is ignored; next round resets shared identity',async()=>{
  const {worker,session,sync}=await setup();
  const stale=structuredClone(session);
  worker.advance(4000);session.clock.paused=true;session.clock.started=true;await sync();
  const before=worker.state().clockInfo;
  const response=await worker.send({type:'session-status',session:sessionStatus(stale),clockInfo:originalClockInfo(stale.clock,worker.now,worker.now)});
  assert.equal(response.stale,true);assert.deepEqual(worker.state().clockInfo,before);
  session.round=2;session.clock={...session.clock,paused:false,started:false,limit_ms:300000,remaining_ms:300000,deadline_ms:null,started_at_ms:null};
  await sync(true);assert.equal(worker.state().round,2);assert.equal(worker.state().clockInfo.started,false);
  assert.equal(worker.state().clockInfo.limitMs,300000);
});
