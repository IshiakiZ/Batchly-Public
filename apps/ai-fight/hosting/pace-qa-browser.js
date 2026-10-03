const frame=document.querySelector('#game'),output=document.querySelector('#results'),evidence=document.querySelector('#evidence');
const runButton=document.querySelector('#run'),checkButton=document.querySelector('#check'),sayButton=document.querySelector('#say');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const starter=await (await fetch('/pace-starter.json')).json();
const id='11111111-1111-4111-8111-111111111111';
let session={id,mode:'fighter',round:1,revision:1,phase:'building',ready:[false,false],builds:[starter,starter],
  clock_settings:{first_round_seconds:360,round_seconds:300},activity:[null,null],checks:[null,null],host_online:true};
let clock={limit:360000,bonus:0,started:null,paused:null,pausedMs:0,expired:false};
let storage={revision:0,files:null},apiSequence=0,lastServerNow=0;
const pending=new Map(),results=[],traffic=[],stats={get:0,session:0,status:0,validation:0,check_result:0,save:0};
const serverNow=()=>Date.now()+120000;
function clockView(){
  const now=serverNow(),limit=clock.limit+clock.bonus;
  const deadline=clock.started===null?null:clock.started+limit+clock.pausedMs+(clock.paused===null?0:now-clock.paused);
  const left=deadline===null?limit:Math.max(0,deadline-now);
  if(clock.started!==null&&clock.paused===null&&clock.limit>0&&left===0)clock.expired=true;
  // Samples are ordered even if two mocked requests finish in one millisecond.
  lastServerNow=Math.max(now,lastServerNow+1);
  return {enabled:clock.limit>0,started:clock.started!==null,paused:clock.paused!==null,expired:clock.expired,
    remaining_ms:left,deadline_ms:deadline,server_now_ms:lastServerNow,limit_ms:limit,started_at_ms:clock.started};
}
function view(){return structuredClone({...session,clock:clockView()});}
function render(){
  output.textContent=results.length?JSON.stringify(results,null,2):'Ready. Use the original controls or run the checks.';
  evidence.textContent=JSON.stringify({stats,session:{id:session.id,round:session.round,revision:session.revision,phase:session.phase,clock:clockView()},recent:traffic.slice(-14)},null,2);
}
function record(name,pass,detail){
  results.push({name,pass,...(detail===undefined?{}:{detail})});render();if(!pass)throw new Error(name);
}
function api(url,body){
  return new Promise((resolve,reject)=>{
    const id=++apiSequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Original UI request timed out: '+url));},25000);
    pending.set(id,{resolve,reject,timer});frame.contentWindow.postMessage({type:'pace-qa-api',id,url,body},'*');
  });
}
async function until(read,predicate,timeout=25000){
  const deadline=Date.now()+timeout;let value;
  while(Date.now()<deadline){value=await read();if(predicate(value))return value;await wait(200);}
  throw new Error('QA condition timed out: '+JSON.stringify(value));
}
function host(action,args){
  if(args.session_id!==session.id)throw new Error('Unknown QA session');
  if(action==='get'){stats.get++;return view();}
  if(action==='clock'){
    if(args.expected_round!==session.round)throw new Error('Round changed');
    const current=clockView(),now=serverNow(),command=args.command;
    if(command==='settings'){
      session.clock_settings=structuredClone(args.settings);
      if(session.phase==='building'&&!current.expired){
        clock.limit=(session.round===1?args.settings.first_round_seconds:args.settings.round_seconds)*1000;
        if(!clock.limit){clock.started=null;clock.paused=null;}
      }
    }else{
      if(session.phase!=='building'||current.expired||!current.enabled)throw new Error('Build clock is unavailable');
      if(command==='start'){if(clock.started!==null)throw new Error('Already started');clock.started=now;}
      else if(command==='pause'){if(clock.started===null||clock.paused!==null)throw new Error('Not running');clock.paused=now;}
      else if(command==='resume'){if(clock.paused===null)throw new Error('Not paused');clock.pausedMs+=now-clock.paused;clock.paused=null;}
      else if(command==='add')clock.bonus+=60000;
      else throw new Error('Unknown clock command');
    }
    return view();
  }
  if(action==='check_result'){
    const job=session.checks[args.side];
    if(session.phase!=='building'||args.expected_round!==session.round||job?.id!==args.check_id||job?.status!=='queued')throw new Error('Stale check');
    stats.check_result++;session.checks[args.side]={...job,status:'completed',result:structuredClone(args.result)};
    return view();
  }
  if(action==='force_start'){
    if(args.expected_revision!==session.revision)throw new Error('Build changed');
    session.builds=structuredClone(args.files);session.ready=[true,true];session.phase='ready';session.revision++;return view();
  }
  if(action==='complete'){session.phase='round_over';session.result=args.result;session.revision++;return view();}
  throw new Error('Use page reload for a fresh QA session; unsupported mock action '+action);
}
addEventListener('message',event=>{
  if(event.source!==frame.contentWindow||event.origin!=='null')return;
  const data=event.data;
  if(data?.type==='pace-qa-loaded'){
    runButton.disabled=false;checkButton.disabled=false;sayButton.disabled=false;render();return;
  }
  if(data?.type==='pace-qa-api-result'){
    const call=pending.get(data.id);if(!call)return;pending.delete(data.id);clearTimeout(call.timer);
    if(data.error)call.reject(new Error(data.error));else call.resolve(data.result);return;
  }
  if(data?.type==='pace-qa-traffic'){
    if(data.kind==='session')stats.session++;
    if(data.kind==='session-status')stats.status++;
    if(data.kind==='validation')stats.validation++;
    if(['session','session-status','validation'].includes(data.kind))traffic.push({kind:data.kind,round:data.round,deadline:data.clock?.deadline,remaining:data.clock?.remainingMs,at:Date.now()});
    render();return;
  }
  if(data?.type==='ai-fight-request'){
    let result;try{result={ok:true,session:host(data.action,data.args)};}catch(error){result={ok:false,error:error.message};}
    frame.contentWindow.postMessage({type:'ai-fight-response',requestId:data.requestId,result},'*');render();return;
  }
  if(data?.type==='ai-fight-storage-request'){
    let result;
    if(data.action==='load')result={ok:true,...storage};
    else if(data.action==='save'&&data.args.expected_revision===storage.revision){
      storage={revision:storage.revision+1,files:structuredClone(data.args.files)};stats.save++;result={ok:true,revision:storage.revision};
    }else result={ok:false,error:'QA storage revision changed'};
    frame.contentWindow.postMessage({type:'ai-fight-storage-response',requestId:data.requestId,result},'*');render();
  }
});
frame.src=frame.dataset.src;
function queueCheck(){
  if(session.phase!=='building'||clockView().expired)throw new Error('Reload QA for a new build phase');
  session.checks[0]={id:crypto.randomUUID(),status:'queued',round:session.round,build_revision:session.revision,build_hash:'qa-starter-unchanged'};
  render();
}
checkButton.onclick=()=>{try{queueCheck();}catch(error){results.push({pass:false,error:error.message});render();}};
sayButton.onclick=()=>{session.activity[0]={message:'Checking the original starter through MCP',at:new Date(serverNow()).toISOString()};render();};
runButton.onclick=async()=>{
  runButton.disabled=true;checkButton.disabled=true;sayButton.disabled=true;results.length=0;
  try{
    let bootstrap=await until(()=>api('/api/bootstrap'),b=>b.state.clockInfo.enabled&&stats.session===1);
    record('actual original four modes and valid starter',bootstrap.modes.length===4&&bootstrap.cards.claude.valid&&bootstrap.cards.chatgpt.valid);
    record('shared clock initially unstarted',!bootstrap.state.clockInfo.started);
    record('add before start',(await api('/api/host/clock-add',{})).ok);
    bootstrap=await api('/api/bootstrap');record('unstarted bonus mirrored',!bootstrap.state.clockInfo.started&&bootstrap.state.clockInfo.limitMs===420000);
    record('start',(await api('/api/host/clock-start',{})).ok);
    record('pause',(await api('/api/host/clock-pause',{})).ok);
    const paused=(await api('/api/bootstrap')).state.clockInfo.remainingMs;await wait(1100);
    record('paused clock remains frozen',(await api('/api/bootstrap')).state.clockInfo.remainingMs===paused);
    record('resume',(await api('/api/host/clock-resume',{})).ok);
    record('add after start',(await api('/api/host/clock-add',{})).ok);
    const before={...stats};await wait(8500);
    record('two heartbeat polls preserve source/round without validation',stats.get>=before.get+2&&stats.session===before.session&&stats.validation===before.validation&&session.round===1,
      {before,after:{...stats}});
    record('heartbeat does not repeatedly persist snapshots',stats.save<=before.save+1,{before:before.save,after:stats.save});
    session.activity[0]={message:'Testing the original starter now',at:new Date(serverNow()).toISOString()};
    const beforeCheck={...stats};queueCheck();
    await until(async()=>session.checks[0],job=>job?.status==='completed');
    record('queued check uses one disposable worker and exact report',session.checks[0].result.ok&&stats.validation===beforeCheck.validation+1&&stats.check_result===beforeCheck.check_result+1,session.checks[0]);
    await wait(4300);
    bootstrap=await api('/api/bootstrap');
    record('same check and say are reflected once',bootstrap.state.activity.claude.checks===1&&bootstrap.state.activity.claude.says===1&&stats.validation===beforeCheck.validation+1);
    record('settings control',(await api('/api/host/settings',{firstRoundLimitSec:1,roundLimitSec:300})).ok);
    // Remove the earlier two-minute bonus through elapsed mock server time. The
    // response remains an ordinary shared deadline; no original timer is invoked.
    clock.started=serverNow()-clock.limit-clock.bonus-1;
    bootstrap=await until(()=>api('/api/bootstrap'),b=>['countdown','fighting','round_over'].includes(b.state.phase));
    record('original timeout auto-locks both current builds',bootstrap.state.fighters.claude.ready&&bootstrap.state.fighters.chatgpt.ready&&bootstrap.state.clockInfo.expired);
    record('settings after expiry',(await api('/api/host/settings',{firstRoundLimitSec:20,roundLimitSec:900})).ok);
    bootstrap=await api('/api/bootstrap');record('expired clock stays expired while future limits change',bootstrap.state.clockInfo.expired&&bootstrap.state.settings.roundLimitSec===900);
    document.body.dataset.passed='true';
  }catch(error){results.push({pass:false,error:error.stack});document.body.dataset.passed='false';render();}
  finally{document.body.dataset.complete='true';render();}
};
