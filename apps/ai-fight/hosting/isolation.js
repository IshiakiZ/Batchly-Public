const MAX_OUTPUT=64*1024*1024;
const TIMEOUT=20000;
const FRAME=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><script>
let worker;
addEventListener('message',event=>{
 if(event.source!==parent)return;
 if(event.data.type==='start'&&!worker){worker=new Worker(URL.createObjectURL(new Blob([event.data.source],{type:'text/javascript'})));worker.onmessage=event=>{try{const text=JSON.stringify(event.data);if(text.length<=67108864)parent.postMessage({type:'worker',text},'*');}catch{}};worker.onerror=()=>parent.postMessage({type:'failed'},'*');}
 else if(event.data.type==='input'&&worker)worker.postMessage(event.data.message);
});
parent.postMessage({type:'ready'},'*');
<\/script>`;

// The frame is opaque and has no network. Removing it terminates its Worker.
export async function isolatedWorker(sourceURL,onMessage,onFailure) {
  const response=await fetch(sourceURL,{credentials:'omit'});
  if(!response.ok)throw new Error('Original game runtime could not load');
  const source=await response.text();
  const frame=document.createElement('iframe');frame.hidden=true;frame.setAttribute('sandbox','allow-scripts');
  let pingAt=Date.now(),expectedNonce=null,closed=false,resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const close=()=>{if(closed)return;closed=true;clearInterval(watchdog);removeEventListener('message',receive);frame.remove();};
  const fail=error=>{close();rejectReady(error);onFailure(error);};
  const receive=event=>{
    if(event.source!==frame.contentWindow||event.origin!=='null')return;
    if(event.data?.type==='ready'){frame.contentWindow.postMessage({type:'start',source},'*');resolveReady();return;}
    if(event.data?.type==='failed'){fail(new Error('Original game Worker failed'));return;}
    if(event.data?.type!=='worker'||typeof event.data.text!=='string'||event.data.text.length>MAX_OUTPUT)return;
    try{const data=JSON.parse(event.data.text);if(data.type==='pong'){if(data.nonce===expectedNonce)expectedNonce=null;return;}onMessage(data);}catch(error){fail(error);}
  };
  // A fresh challenge must pass through the Worker's event loop. Forged output
  // or a tight postMessage loop cannot extend this watchdog's deadline.
  const watchdog=setInterval(()=>{
    if(expectedNonce&&Date.now()-pingAt>TIMEOUT){fail(new Error('Brain execution timed out. The isolated Worker was terminated.'));return;}
    if(!expectedNonce){expectedNonce=crypto.randomUUID();pingAt=Date.now();frame.contentWindow.postMessage({type:'input',message:{type:'ping',nonce:expectedNonce}},'*');}
  },1000);
  addEventListener('message',receive);frame.srcdoc=FRAME;document.body.append(frame);
  await ready;
  return {send:message=>{if(closed)throw new Error('Worker closed');frame.contentWindow.postMessage({type:'input',message},'*');},close};
}

export async function runOriginalSimulation(job) {
  if(JSON.stringify(job).length>220*1024)throw new Error('Simulation input exceeds browser limit');
  return new Promise((resolve,reject)=>{
    let worker,settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);worker?.close();if(error)reject(error);else resolve(result);};
    const timer=setTimeout(()=>finish(new Error('Simulation timed out. Its Worker was terminated.')),TIMEOUT);
    isolatedWorker(new URL('./original-sim-worker.js',import.meta.url),message=>{
      if(message.type!=='sim-result')return;
      const result=message.result;
      if(!result||typeof result!=='object')return finish(new Error('Invalid simulation result'));
      if(result.replay)result.replay={...result.replay,unranked:true,source:'host-browser'};
      finish(null,result);
    },error=>finish(error)).then(value=>{worker=value;if(settled)worker.close();else worker.send(job);}).catch(error=>finish(error));
  });
}

// This disposable lane accepts validation data only. A brain can forge its own
// unranked check result, but cannot send server events or account/storage requests.
export async function runOriginalValidation(job){
  if(JSON.stringify(job).length>220*1024)throw new Error('Validation input exceeds browser limit');
  return new Promise((resolve,reject)=>{
    let worker,settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);worker?.close();if(error)reject(error);else resolve(result);};
    const timer=setTimeout(()=>finish(new Error('Brain validation timed out. Its Worker was terminated.')),TIMEOUT);
    isolatedWorker(new URL('./original-validation-worker.js',import.meta.url),message=>{
      if(message.type!=='validation-result')return;
      const result=message.result;
      if(!result?.check||typeof result.check.ok!=='boolean'||!Array.isArray(result.check.errors)||!Array.isArray(result.check.warnings)||JSON.stringify(result).length>1024*1024)return finish(new Error('Invalid brain validation result'));
      finish(null,result);
    },error=>finish(error)).then(value=>{worker=value;if(settled)worker.close();else worker.send(job);}).catch(error=>finish(error));
  });
}
