const send = self.postMessage.bind(self);
for(const key of ['Worker','SharedWorker','importScripts','fetch','XMLHttpRequest','WebSocket','WebTransport','EventSource'])Object.defineProperty(self,key,{value:undefined,writable:false,configurable:false});
self.onmessage=event=>{
  if(event.data?.type==='ping')return;
  const job=event.data;
  try{
    const env=originalEnvironment(ORIGINAL_SOURCES);
    let check,load=null;
    if(job.mode==='fighter'){
      const bundle=env.load('engine/loader.js').bundleFromSnapshot(job.snapshot);
      const brain=env.load('engine/sandbox.js').createBrain(bundle.brain,{seed:1,label:'live',lib:bundle.lib});
      load={ok:!!brain.ok,error:brain.error||null};
      check=env.load('engine/match.js').fullCheck(bundle,{level:job.level,mirror:job.mirror});
    }else{
      const modes=env.load('engine/modes/index.js');
      check=modes.safeCheck(modes.get(job.mode),modes.bundleFromSnapshot(job.snapshot),job.level);
    }
    send({type:'validation-result',result:{check,load}});
  }catch(error){send({type:'validation-result',result:{check:{ok:false,errors:[String(error.message||error)],warnings:[],spec:null},load:{ok:false,error:String(error.message||error)}}});}
};
