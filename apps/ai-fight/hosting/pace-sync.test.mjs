import test from 'node:test';
import assert from 'node:assert/strict';
import {originalClockInfo,compactCheckResult,queuedCheckTarget,checkStillCurrent} from './pace-sync.js';

const clock={enabled:true,started:true,paused:false,expired:false,server_now_ms:100000,deadline_ms:160000,remaining_ms:60000,limit_ms:60000,started_at_ms:100000};
test('server clock translates once and keeps ticking between polls',()=>{
  const info=originalClockInfo(clock,500000,504000);
  assert.equal(info.deadline,560000);assert.equal(info.remainingMs,56000);assert.equal(info.startedAt,500000);
  assert.equal(originalClockInfo(clock,500000,560001).expired,true);
});
test('pause freezes remaining, add before start increases limit, zero disables',()=>{
  assert.equal(originalClockInfo({...clock,paused:true,remaining_ms:31000},500000,999999).remainingMs,31000);
  const unstarted=originalClockInfo({...clock,started:false,deadline_ms:null,started_at_ms:null,limit_ms:120000,remaining_ms:120000},500000);
  assert.equal(unstarted.remainingMs,120000);assert.equal(unstarted.expired,false);
  assert.equal(originalClockInfo({...clock,enabled:false,started:false,deadline_ms:null,remaining_ms:0},500000).remainingMs,null);
});
test('queued job binds exact own source and round, ignores unrelated revision',()=>{
  const s={id:'a',mode:'fighter',round:1,phase:'building',revision:2,builds:[{'brain.js':'one'},{}],checks:[{id:'job',round:1,status:'queued',build_revision:2,build_hash:'hash'},null]};
  const target=queuedCheckTarget(s,0,1);
  assert.equal(checkStillCurrent(target,{...s,revision:9,builds:[s.builds[0],{'brain.js':'other'}]},'a',1),true);
  for(const changed of [{...s,round:2},{...s,builds:[{'brain.js':'two'},{}]},{...s,checks:[{...s.checks[0],id:'new'},null]},{...s,phase:'ready'}]){
    assert.equal(checkStillCurrent(target,changed,'a',1),false);
  }
  assert.equal(checkStillCurrent(target,s,'b',1),false);
  assert.equal(checkStillCurrent(target,s,'a',2),false);
});
test('UTF-8 check results leave space for jsonb separators and preserve failures',()=>{
  const value=compactCheckResult({check:{ok:true,errors:Array(20).fill('⚠'.repeat(400)),warnings:Array(20).fill('⚠'.repeat(400))},load:{ok:false,error:'failed'}});
  assert.equal(value.ok,false);assert.equal(value.load_error,'failed');
  assert.ok(Buffer.byteLength(JSON.stringify(value))<=7800);
  assert.ok(Buffer.byteLength(JSON.stringify(value).replaceAll(',',', ').replaceAll(':',': '))<=8192);
  assert.equal(compactCheckResult({check:{ok:false}}).errors[0],'Validation failed.');
});
