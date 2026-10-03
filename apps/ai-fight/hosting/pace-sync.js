import {stable} from './session-binding.js';

// Translate the server's epoch into the browser's wall clock. Paused clocks keep
// their returned remaining time; running clocks continue between four-second polls.
export function originalClockInfo(clock,receivedAt,now=Date.now()){
  if(!clock||!Number.isFinite(clock.server_now_ms)||!Number.isFinite(receivedAt))return null;
  const enabled=clock.enabled===true,started=clock.started===true,paused=clock.paused===true;
  const deadline=Number.isFinite(clock.deadline_ms)?receivedAt+clock.deadline_ms-clock.server_now_ms:null;
  const remaining=enabled&&started&&!paused&&deadline!==null
    ?Math.max(0,deadline-now):Math.max(0,Number(clock.remaining_ms)||0);
  return {sampleAt:receivedAt,enabled,started,paused,running:enabled&&started&&!paused&&!clock.expired&&remaining>0,
    expired:enabled&&(clock.expired===true||(started&&!paused&&deadline!==null&&remaining===0)),
    limitMs:Math.max(0,Number(clock.limit_ms)||0),remainingMs:enabled?remaining:null,deadline,
    startedAt:Number.isFinite(clock.started_at_ms)?receivedAt+clock.started_at_ms-clock.server_now_ms:null};
}

export function sourceSyncKey(session){
  return stable([session.id,session.mode,session.round,session.builds]);
}
export function sessionSyncKey(session){
  return stable([sourceSyncKey(session),session.phase,session.ready]);
}
export function sessionStatus(session){
  const {id,mode,round,revision,phase,clock,clock_settings,activity,checks,host_online}=session;
  return {id,mode,round,revision,phase,clock,clock_settings,activity,checks,host_online};
}
export function queuedCheckTarget(session,side,generation){
  const job=session?.checks?.[side],files=session?.builds?.[side];
  if(session?.phase!=='building'||job?.status!=='queued'||job.round!==session.round||!files)return null;
  return {id:session.id,round:session.round,mode:session.mode,side,generation,checkId:job.id,
    buildHash:job.build_hash,buildRevision:job.build_revision,sourceKey:stable(files)};
}
export function checkStillCurrent(target,session,id,generation){
  const next=queuedCheckTarget(session,target.side,generation);
  return id===target.id&&!!next&&stable(next)===stable(target);
}

export function compactCheckResult(value){
  const check=value?.check||{};
  const strings=list=>Array.isArray(list)?list.filter(item=>typeof item==='string').slice(0,12).map(item=>item.slice(0,400)):[];
  const result={ok:check.ok===true,errors:strings(check.errors),warnings:strings(check.warnings)};
  if(value?.load?.ok===false){result.ok=false;result.load_error=String(value.load.error||'Brain could not load').slice(0,400);}
  if(!result.ok&&!result.errors.length&&!result.load_error)result.errors=['Validation failed.'];
  const bytes=()=>new TextEncoder().encode(JSON.stringify(result)).length;
  // PostgreSQL jsonb adds spaces after separators. Leave room for that encoding.
  while(bytes()>7800){if(result.warnings.length)result.warnings.pop();else if(result.errors.length>1)result.errors.pop();else break;}
  return result;
}
