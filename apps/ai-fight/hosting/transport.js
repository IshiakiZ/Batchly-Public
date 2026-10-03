import {isolatedWorker,runOriginalSimulation,runOriginalValidation} from './isolation.js';
import {hostRequest} from './host-bridge.js';
import {storageRequest,validateSnapshot,loadSavedFiles} from './storage-bridge.js';
import {stable,snapshotFromFiles,sameSnapshot,sessionStillMatches} from './session-binding.js';
import {toast as originalToast} from './js/util.js';

const nativeFetch=globalThis.fetch.bind(globalThis);
const base=new URL('./',import.meta.url);
let sessionId=new URL(location.href).searchParams.get('session');
const pending=new Map(),streams=new Set(),simulations=new Map();
let worker,session,lastRevision=-1,sseBuffer='',completionRevision=null;
let hostControlPending=false,generation=0,completionBinding=null,localState=null;
let storageRevision=0,storageLoaded=false,storageStopped=false,saveTimer,saveRunning=false,saveAgain=false,syncedSessionId=null;
async function saveSnapshot(){
  clearTimeout(saveTimer);
  if(!storageLoaded||storageStopped)return;
  if(saveRunning){saveAgain=true;return;}
  saveRunning=true;
  try{
    await boot;
    const files=await send({type:'snapshot'});
    files['data/batchly-host.json']=JSON.stringify({version:1,session_id:sessionId,completionBinding});
    validateSnapshot(files);
    const saved=await storageRequest('save',{expected_revision:storageRevision,files});
    storageRevision=saved.revision;
  }catch(error){storageStopped=true;originalToast(error.message,'error');}
  finally{saveRunning=false;if(saveAgain&&!storageStopped){saveAgain=false;void saveSnapshot();}}
}
function scheduleSave(immediate=false){
  if(!storageLoaded||storageStopped)return;
  clearTimeout(saveTimer);
  if(immediate)void saveSnapshot();else saveTimer=setTimeout(saveSnapshot,800);
}
function adoptSession(value,requestedId){
  if(requestedId!==sessionId||value.id!==requestedId)return false;
  if(session?.id===requestedId&&session.revision>value.revision)return false;
  if(session&&session.round!==value.round){generation++;completionBinding=null;}
  session=value;return true;
}
let resolveBoot,rejectBoot;
const boot=new Promise((resolve,reject)=>{resolveBoot=resolve;rejectBoot=reject;});
boot.catch(()=>{});

function emit(name,value){const text=typeof value==='string'?value:JSON.stringify(value);for(const stream of streams)stream.dispatchEvent(new MessageEvent(name,{data:text}));}
function fail(error){rejectBoot(error);for(const request of pending.values()){clearTimeout(request.timer);request.reject(error);}pending.clear();emit('toast',{level:'error',text:error.message});for(const stream of streams)stream.dispatchEvent(new Event('error'));}
function adaptBootstrap(data){
  if(data.mode?.view)data.mode.view=new URL(data.mode.view.replace(/^\//,''),base).href;
  for(const [side,id] of data.config.fighters.map((fighter,side)=>[side,fighter.id])) {
    if(!sessionId){
      data.prompts[id]=side===0
        ? `Connect to Batchly MCP with your creator token. Call ai_fight_create_session with mode "${data.mode.id}". Share its host_url and session ID with me so I can open the original game in Batchly and give the session ID to the other agent. You are side 0. Then follow mode_help: get the session, submit your full files with the current expected_revision, ready, and poll for the result. Do not run the local arena.js CLI.`
        : `Connect to Batchly MCP using a different creator token on the same owner's account. Use the AI Fight session ID shared by the first agent; do not create a separate session. You are side 1. Call ai_fight_get_session, read mode_help, submit your full files with the current expected_revision, ready, and poll for the result. The owner must keep the host page open. Do not run the local arena.js CLI.`;
      continue;
    }
    data.prompts[id]=`You are ${data.config.fighters[side].label} playing the original AI Fight ${data.mode.name} through Batchly MCP.\nSession: ${sessionId}\nYour side: ${side}. Use your own creator token; the other agent must use a different token on the same owner's account.\n1. Call ai_fight_get_session with session_id. Read mode_help and the original guide at ${new URL(data.mode.guide,base).href}.\n2. Edit the complete design and JavaScript source files for this mode.\n3. Call ai_fight_submit_build with session_id, side, expected_revision from the latest read, and files.\n4. Call ai_fight_ready with session_id, side, and the new expected_revision.\n5. Poll ai_fight_get_session for the result. On the next round, evolve your files and repeat. Stop when phase is complete.\nKeep the signed-in host page open. Browser results are unranked. Do not run arena.js or access another agent's files.`;
  }
  return data;
}
function acceptSse(chunk){
  sseBuffer+=chunk;
  if(sseBuffer.length>8*1024*1024)throw new Error('Game update exceeds browser limit');
  let boundary;
  while((boundary=sseBuffer.indexOf('\n\n'))>=0){
    const packet=sseBuffer.slice(0,boundary);sseBuffer=sseBuffer.slice(boundary+2);
    const name=/^event: ?(.+)$/m.exec(packet)?.[1];const raw=/^data: ?(.+)$/m.exec(packet)?.[1];
    if(!name||!raw)continue;
    const data=JSON.parse(raw);
    if(name==='bootstrap')adaptBootstrap(data);
    if(name==='state'||name==='bootstrap')localState=name==='state'?data:data.state;
    emit(name,data);
    if(['bootstrap','card','feed','activity','test','match','state'].includes(name))scheduleSave(name==='match'||name==='state');
    if(sessionId&&['state','bootstrap'].includes(name)&&['round_over','match_over'].includes(localState?.phase))void publishCompletion(localState);
  }
}
async function publishCompletion(state){
  const target=completionBinding&&{...completionBinding,generation};
  if(!sessionStillMatches(target,session,sessionId,generation)||state.round!==target.round||state.matchId!==target.matchId||completionRevision===target.revision||hostControlPending)return;
  completionRevision=target.revision;
  try {
    const response=await request('/api/replay/current');const replay=JSON.parse(response.body);
    if(!sessionStillMatches(target,session,sessionId,generation)||localState?.matchId!==target.matchId||hostControlPending)return;
    const completed=await hostRequest('complete',{session_id:target.id,expected_revision:target.revision,result:{...replay.result,unranked:true,source:'host-browser'}});
    if(sessionStillMatches(target,session,sessionId,generation))adoptSession(completed,target.id);
  } catch(error){if(target.generation===generation){completionRevision=null;emit('toast',{level:'error',text:error.message});}}
}
async function ensureHostReady(job,matchId,jobGeneration){
  if(!sessionId)return null;
  const id=sessionId;
  const stillCurrent=()=>id===sessionId&&jobGeneration===generation&&!hostControlPending&&localState?.matchId===matchId;
  if(!stillCurrent())throw new Error('The match changed before the fight started');
    const refreshed=await hostRequest('get',{session_id:id});
    if(!stillCurrent())throw new Error('The account match changed before the fight started');
    adoptSession(refreshed,id);
    if(!stillCurrent()||session.round!==job.round||(job.mode||'fighter')!==session.mode)throw new Error('The account round has already changed');
    if(!['ready','building'].includes(session.phase))throw new Error('The account round has already changed');
    const stale=session.ready.some((ready,side)=>ready&&!sameSnapshot(session.mode,job.snapshots[side],snapshotFromFiles(session.mode,session.builds[side])));
    if(stale){
      // Rebuild the original locks and job from the confirmed account files. The
      // old job never runs, even if another agent became ready during this read.
      await send({type:'session',session,restart:true});
      const error=new Error('Rebuilding the fight from the confirmed locked files');error.superseded=true;throw error;
    }
    if(session.phase!=='ready'){
    const locked=await send({type:'locked-files'});
    if(!stillCurrent())throw new Error('The match changed while builds were locking');
    // Preserve the exact strings already locked by a remote agent. The original
    // snapshot writer may normalize JSON whitespace, which is not a build edit.
    const files=locked.map((build,side)=>session.ready[side]?session.builds[side]:build);
    const lockedSession=await hostRequest('force_start',{session_id:id,expected_revision:session.revision,files});
    if(!stillCurrent())throw new Error('The match changed while builds were locking');
    adoptSession(lockedSession,id);
    }
    if(session.phase!=='ready'||!session.builds.every((files,side)=>sameSnapshot(session.mode,job.snapshots[side],snapshotFromFiles(session.mode,files))))throw new Error('The locked builds changed before simulation');
    return {id,round:session.round,revision:session.revision,generation:jobGeneration,matchId,buildKey:stable(session.builds)};
}
function send(message){return new Promise((resolve,reject)=>{
  const id=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Original game request timed out'));},22000);
  pending.set(id,{resolve,reject,timer});worker.send({...message,id});
});}
async function request(url,method='GET',body='') {await boot;return send({type:'request',url,method,body});}

export async function installOriginalTransport(){
  worker=await isolatedWorker(new URL('./original-server-worker.js',base),message=>{
    if(message.type==='initialized'){resolveBoot();return;}
    if(message.type==='sse'){acceptSse(message.chunk);return;}
    if(message.type==='validate'){
      runOriginalValidation(message.job).catch(error=>({check:{ok:false,errors:[error.message],warnings:[],spec:null},load:{ok:false,error:error.message}}))
        .then(result=>worker.send({type:'validation-result',id:message.id,result}));return;
    }
    if(message.type==='response'||message.type==='failure'){
      const handler=pending.get(message.id);if(!handler){if(message.type==='failure')fail(new Error(message.error));return;}
      pending.delete(message.id);clearTimeout(handler.timer);
      if(message.type==='failure')handler.reject(new Error(message.error));else handler.resolve(message.response);return;
    }
    if(message.type==='simulate'){
      if(simulations.size>=2){worker.send({type:'simulation-result',id:message.id,result:{ok:false,error:'Too many simultaneous simulations'}});return;}
      const marker={generation,matchId:message.matchId};simulations.set(message.id,marker);
      // Exhibitions have no effect on the account match. Real rounds must first
      // synchronize the original forced/clock-triggered lock with the owner lane.
      (message.job.kind==='exhibition'?Promise.resolve(null):ensureHostReady(message.job,message.matchId,marker.generation)).then(async target=>{
        if(simulations.get(message.id)!==marker||marker.generation!==generation)return;
        const result=await runOriginalSimulation(message.job);
        if(simulations.get(message.id)!==marker||marker.generation!==generation||(target&&!sessionStillMatches(target,session,sessionId,generation)))return;
        if(target&&result.ok){completionBinding=target;scheduleSave(true);}
        worker.send({type:'simulation-result',id:message.id,result});
      })
        .catch(error=>{if(!error.superseded&&simulations.get(message.id)===marker&&marker.generation===generation)worker.send({type:'simulation-result',id:message.id,result:{ok:false,error:error.message}});})
        .finally(()=>{if(simulations.get(message.id)===marker)simulations.delete(message.id);});return;
    }
    if(message.type==='cancel-simulation')simulations.delete(message.id);
  },fail);

  const OriginalEventSource=globalThis.EventSource;
  class LocalEvents extends EventTarget {
    constructor(url){super();if(url!=='/events')return new OriginalEventSource(url);this.readyState=0;streams.add(this);
      boot.then(async()=>{this.readyState=1;this.dispatchEvent(new Event('open'));const response=await request('/api/bootstrap');this.dispatchEvent(new MessageEvent('bootstrap',{data:JSON.stringify(adaptBootstrap(JSON.parse(response.body)))}));}).catch(()=>this.dispatchEvent(new Event('error')));}
    close(){streams.delete(this);this.readyState=2;}
  }
  globalThis.EventSource=LocalEvents;
  globalThis.fetch=async(input,options={})=>{
    const text=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(text.startsWith('/api/')){
      if((options.body?.length||0)>180*1024)return Response.json({ok:false,message:'Request too large'},{status:413});
      if(text==='/api/host/force-start'&&sessionId){
        try{const id=sessionId;const fresh=await hostRequest('get',{session_id:id});if(adoptSession(fresh,id))await send({type:'session',session:fresh});}
        catch(error){return Response.json({ok:false,message:error.message},{status:409});}
      }
      if(sessionId&&text.startsWith('/api/host/')) {
        const action=text.slice('/api/host/'.length);
        if(['end','new-match','next'].includes(action)){
          if(hostControlPending)return Response.json({ok:false,message:'A host action is already pending'},{status:409});
          hostControlPending=true;
          generation++;completionRevision=null;
          try{
            const id=sessionId;adoptSession(await hostRequest('get',{session_id:id}),id);
            if(action==='end')adoptSession(await hostRequest('end',{session_id:id,expected_revision:session.revision}),id);
            if(action==='new-match'){
              if(session.phase!=='complete')adoptSession(await hostRequest('end',{session_id:id,expected_revision:session.revision}),id);
              const created=await hostRequest('create',{mode:JSON.parse(options.body||'{}').mode||session.mode});
              session=created;sessionId=created.id;lastRevision=-1;completionRevision=null;completionBinding=null;
            }
            if(action==='next')adoptSession(await hostRequest('next',{session_id:id,expected_revision:session.revision}),id);
            const response=await request(text,options.method||'GET',options.body||'');
            if(action==='new-match')syncedSessionId=sessionId;
            scheduleSave(true);
            return new Response(response.body,{status:response.status,headers:response.headers});
          }catch(error){return Response.json({ok:false,message:error.message},{status:409});}
          finally{hostControlPending=false;}
        }
      }
      if(!sessionId&&['/api/host/new-match','/api/host/end','/api/host/next'].includes(text)){generation++;completionBinding=null;}
      const response=await request(text,options.method||'GET',options.body||'');
      if(options.method==='POST')scheduleSave(true);
      return new Response(response.body,{status:response.status,headers:response.headers});
    }
    if(/^\/(audio|fonts)\//.test(text))return nativeFetch(new URL(text.slice(1),base),{...options,credentials:'omit'});
    return nativeFetch(input,options);
  };
  const OriginalAudio=globalThis.Audio;
  globalThis.Audio=class extends OriginalAudio {constructor(src){super(src?.startsWith('/audio/')?new URL(src.slice(1),base).href:src);this.crossOrigin='anonymous';}};
  document.addEventListener('click',async event=>{
    const link=event.target.closest?.('a[href^="/api/csv/"]');if(!link)return;
    event.preventDefault();
    try{const response=await request(link.getAttribute('href'));if(response.status!==200)throw new Error('No rounds have been recorded yet');
      const url=URL.createObjectURL(new Blob([response.body],{type:'text/csv'}));const download=document.createElement('a');download.href=url;download.download=link.download;download.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){emit('toast',{level:'error',text:error.message});}
  });
  let restored;
  try{
    restored=await loadSavedFiles();storageRevision=restored.revision;
    if(restored.files){
      validateSnapshot(restored.files);
      const meta=JSON.parse(restored.files['data/batchly-host.json']||'{}');
      syncedSessionId=typeof meta.session_id==='string'&&/^[0-9a-f-]{36}$/i.test(meta.session_id)?meta.session_id:null;
      if(!sessionId)sessionId=syncedSessionId;
      if(meta.completionBinding?.id===sessionId)completionBinding=meta.completionBinding;
    }
    storageLoaded=true;
  }catch(error){storageStopped=true;fail(error);setTimeout(()=>originalToast(error.message,'error'),0);return;}
  worker.send({type:'init',files:restored.files||{}});
  addEventListener('pagehide',()=>{void saveSnapshot();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')void saveSnapshot();});
  if(sessionId) {
    const poll=async()=>{
      const id=sessionId;
      try{
        if(hostControlPending)return;
        const refreshed=await hostRequest('get',{session_id:id});
        if(hostControlPending||!adoptSession(refreshed,id))return;
        if(session.revision!==lastRevision){
          const applying=session;
          await boot;
          if(hostControlPending||id!==sessionId||session.revision!==applying.revision)return;
          try{await send({type:'session',session:applying,reset:syncedSessionId!==id});if(id===sessionId){lastRevision=applying.revision;syncedSessionId=id;}}
          catch(error){
            if(id===sessionId&&applying.phase==='ready')adoptSession(await hostRequest('complete',{session_id:id,expected_revision:applying.revision,result:{validation_failed:true,error:error.message,unranked:true}}),id);
            throw error;
          }
        }
        if(['round_over','match_over'].includes(localState?.phase))void publishCompletion(localState);
      }catch(error){emit('toast',{level:'error',text:error.message});}
      finally{setTimeout(poll,4000);}
    };void poll();
  }
}
