import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const here=path.dirname(fileURLToPath(import.meta.url));
// Public packages can run these checks beside their unchanged original source.
export const originalRoot=process.env.AI_FIGHT_ORIGINAL||(
  fs.existsSync(path.join(here,'../server.js'))?path.resolve(here,'..'):'D:/AI Fight');
export function readOriginalSources(root=originalRoot){
  const sources={};
  function walk(dir){for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
    const name=dir+'/'+entry.name;
    if(entry.isSymbolicLink())throw new Error('Source symlinks refused');
    if(entry.isDirectory())walk(name);
    else if(/\.(js|json)$/.test(name))sources[name]=fs.readFileSync(path.join(root,name),'utf8');
  }}
  walk('engine');
  for(const name of ['server.js','config.json','AI_GUIDE.md','ARMY_GUIDE.md','WAR_GUIDE.md','BUSINESS_GUIDE.md'])sources[name]=fs.readFileSync(path.join(root,name),'utf8');
  return sources;
}
export function workerSource(name,sources=readOriginalSources()){
  return 'const ORIGINAL_SOURCES='+JSON.stringify(sources)+';\n'
    +fs.readFileSync(path.join(here,'runtime.cjs'),'utf8')+'\n'
    +fs.readFileSync(path.join(here,name+'-worker.cjs'),'utf8');
}
export async function originalWorkerHarness(){
  const sources=readOriginalSources(),events=[],timers=new Map();
  let now=2000000000000,sequence=0,validations=0,context;
  class ClockDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  function globals(postMessage){
    const global={TextEncoder,TextDecoder,URL,URLSearchParams,Uint8Array,DataView,performance,crypto:webcrypto,structuredClone,Date:ClockDate,
      console:{log(){},error(){},warn(){}},
      setTimeout:fn=>{const id=++sequence;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
      setInterval:fn=>{const id=++sequence;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id),postMessage};
    global.self=global;return global;
  }
  const validationCode=workerSource('validation',sources);
  context=vm.createContext(globals(message=>{
    events.push(structuredClone(message));
    if(message.type==='validate'){
      validations++;
      // Only original starter and normal test sources are used. Each validation
      // still receives a fresh runtime, just like the disposable browser Worker.
      const disposable=vm.createContext(globals(result=>context.onmessage({data:{type:'validation-result',id:message.id,result:result.result}})));
      vm.runInContext(validationCode,disposable);
      disposable.onmessage({data:structuredClone(message.job)});
    }
  }));
  vm.runInContext(workerSource('server',sources),context);
  async function send(message){
    const id=++sequence;await context.onmessage({data:structuredClone({...message,id})});
    const response=events.findLast(event=>event.id===id&&['response','failure'].includes(event.type));
    if(response?.type==='failure')throw new Error(response.error);
    return response?.response;
  }
  await send({type:'init',sharedSession:true});
  return {
    sources,events,send,get validations(){return validations;},get now(){return now;},
    advance(ms){now+=ms;vm.runInContext('serverHooks.setSyncing(false)',context);},
    state(){return structuredClone(vm.runInContext('serverHooks.current().state',context));},
    async json(url,method='GET',body={}){const response=await send({type:'request',url,method,body:JSON.stringify(body)});return JSON.parse(response.body);},
  };
}
