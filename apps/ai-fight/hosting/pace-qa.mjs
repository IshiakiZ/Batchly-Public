import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {here,originalRoot,readOriginalSources,workerSource} from './worker-test-harness.mjs';
import {adaptOriginalPublic} from './public-adapter.mjs';

// This local-only server assembles release inputs in memory. It neither builds
// dist artifacts nor contacts Batchly. Closing/reloading QA discards its storage.
const port=Number(process.argv[2]||8873),origin='http://127.0.0.1:'+port;
const root=path.resolve(process.argv[3]||originalRoot),prefix='/ext/ai-fight-r3/';
const sources=readOriginalSources(root);
const workers=Object.fromEntries(['server','sim','validation'].map(name=>['original-'+name+'-worker.js',workerSource(name,sources)]));
const adapters=new Set(['adapter-entry.js','transport.js','isolation.js','storage-bridge.js','session-binding.js','pace-sync.js','host-bridge.js']);
const starter={'fighter.json':sources['engine/starter/fighter.json'],'brain.js':sources['engine/starter/brain.js']};
const entry=`
import {installOriginalTransport} from './transport.js';
await installOriginalTransport();
await import('./js/app.js');
addEventListener('message',async event=>{
 if(event.source!==parent||event.origin!==${JSON.stringify(origin)}||event.data?.type!=='pace-qa-api')return;
 const {id,url,body}=event.data;
 if(!['/api/bootstrap','/api/host/clock-start','/api/host/clock-pause','/api/host/clock-resume','/api/host/clock-add','/api/host/settings'].includes(url))return;
 try{const response=await fetch(url,body===undefined?{}:{method:'POST',body:JSON.stringify(body)});
 parent.postMessage({type:'pace-qa-api-result',id,result:await response.json()},'*');}
 catch(error){parent.postMessage({type:'pace-qa-api-result',id,error:error.message},'*');}
});
parent.postMessage({type:'pace-qa-loaded'},'*');
`;
const page=`<!doctype html><meta charset="utf-8"><title>AI Fight r3 shared clock QA</title>
<h1>Original AI Fight r3: local shared clock checks</h1>
<p>Real original UI, server and disposable validation workers. Host responses and storage are local mocks.
Storage is isolated to this page, held in memory and discarded on reload. No credentials or live sessions are used.</p>
<button id="run" disabled>Run shared clock checks</button>
<button id="check" disabled>Queue a real starter check</button>
<button id="say" disabled>Send sample MCP progress</button>
<pre id="results">Loading original worker...</pre><details><summary>Poll / validation evidence</summary><pre id="evidence"></pre></details>
<iframe id="game" title="Unchanged original game" sandbox="allow-scripts allow-pointer-lock allow-downloads" style="width:100%;height:800px;border:0" data-src="${prefix}index.html?session=11111111-1111-4111-8111-111111111111"></iframe>
<script type="module" src="/pace-qa-browser.js"></script>`;
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.md':'text/plain','.txt':'text/plain','.woff2':'font/woff2','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
const server=http.createServer((request,response)=>{
  response.setHeader('Access-Control-Allow-Origin','*');
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Security-Policy',`default-src 'self' ${origin} blob: data:; script-src 'self' ${origin} 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'self' ${origin}; style-src 'self' ${origin} 'unsafe-inline'; frame-src 'self' ${origin} blob:`);
  function send(body,type='text/javascript',status=200){response.writeHead(status,{'Content-Type':type+'; charset=utf-8'});response.end(body);}
  try{
    const pathname=decodeURIComponent(new URL(request.url,origin).pathname);
    if(request.method!=='GET')return send('Read-only QA server','text/plain',405);
    if(pathname==='/'||pathname==='/qa')return send(page,'text/html');
    if(pathname==='/pace-starter.json')return send(JSON.stringify(starter),'application/json');
    if(pathname==='/pace-qa-browser.js')return send(fs.readFileSync(path.join(here,'pace-qa-browser.js')));
    if(!pathname.startsWith(prefix))return send('Not found','text/plain',404);
    const name=pathname.slice(prefix.length);
    if(!name||name.split('/').some(part=>!part||part==='..'||part==='.')||name.includes('\\'))return send('Invalid path','text/plain',400);
    if(workers[name])return send(workers[name]);
    if(adapters.has(name)){
      let code=fs.readFileSync(path.join(here,name),'utf8');
      if(name==='adapter-entry.js')code=entry;
      // QA-only origin and passive counters are served in memory. Release files
      // keep their production origin restriction and have no test instrumentation.
      if(name==='host-bridge.js')code=code.replace("['https://batch-ly.com', 'https://www.batch-ly.com']",JSON.stringify([origin]));
      if(name==='transport.js')code=code.replace('function send(message){','function send(message){parent.postMessage({type:"pace-qa-traffic",kind:message.type,round:message.session?.round,clock:message.clockInfo},"*");');
      if(name==='isolation.js')code=code.replace('export async function runOriginalValidation(job){','export async function runOriginalValidation(job){parent.postMessage({type:"pace-qa-traffic",kind:"validation",round:job.level},"*");');
      return send(code);
    }
    if(name.endsWith('_GUIDE.md')&&sources[name])return send(sources[name],'text/plain');
    const originalFile=path.resolve(root,'public',name),publicRoot=path.resolve(root,'public')+path.sep;
    if(!originalFile.startsWith(publicRoot)||!fs.existsSync(originalFile)||!fs.statSync(originalFile).isFile())return send('Not found','text/plain',404);
    return send(adaptOriginalPublic('public/'+name,fs.readFileSync(originalFile)),mime[path.extname(name)]||'application/octet-stream');
  }catch(error){send(error.message,'text/plain',500);}
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:origin+'/',original:root,releasePrefix:prefix,storage:'page-local memory, not shared',artifactsWritten:false})));
