const send = self.postMessage.bind(self);
for (const key of ['Worker','SharedWorker','importScripts','fetch','XMLHttpRequest','WebSocket','WebTransport','EventSource']) {
  Object.defineProperty(self,key,{value:undefined,writable:false,configurable:false});
}
self.onmessage=event=>{
  if(event.data?.type==='ping')return;
  try {
    const environment=originalEnvironment(ORIGINAL_SOURCES,{workerThreads:{workerData:event.data,parentPort:{postMessage:result=>send({type:'sim-result',result})}}});
    environment.load('engine/worker.js');
  } catch(error){send({type:'sim-result',result:{ok:false,error:String(error.message||error)}});}
};
