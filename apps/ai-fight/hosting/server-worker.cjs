const send = self.postMessage.bind(self);
for (const key of ['Worker','SharedWorker','importScripts','fetch','XMLHttpRequest','WebSocket','WebTransport','EventSource']) {
  Object.defineProperty(self,key,{value:undefined,writable:false,configurable:false});
}
let environment, serverHooks;
const simulations = new Map();
const validations=new Map(),checks=new Map(),loads=new Map();
let sequence = 0;
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
function canonicalSnapshot(mode,snapshot){
  snapshot={...snapshot,lib:snapshot.lib&&Object.keys(snapshot.lib).length?snapshot.lib:null};
  return mode==='fighter'?{fighter:snapshot.fighter??null,brain:snapshot.brain??null,lib:snapshot.lib||null,sprite:snapshot.sprite??null,notes:snapshot.notes??null}
    :{mode,design:snapshot.design??null,brain:snapshot.brain??null,lib:snapshot.lib||null,notes:snapshot.notes??null};
}
function validationJob(mode,snapshot,level){return {mode,snapshot:canonicalSnapshot(mode,snapshot),level,mirror:environment.load('config.json').mirrorFirstRound!==false};}
function cachedCheck(mode,bundle,level){
  const loader=environment.load(mode==='fighter'?'engine/loader.js':'engine/modes/index.js');
  const job=validationJob(mode,loader.snapshotOf(bundle),level);
  const value=checks.get(stable(job));
  if(!value)throw new Error('Build validation is not prepared');
  const check=structuredClone(value.check);
  if(bundle.readErrors?.length){check.errors.push(...bundle.readErrors);check.ok=false;}
  return check;
}
function mapServerModule(name,exports){
  if(name==='engine/match.js')return {...exports,fullCheck:(bundle,options={})=>cachedCheck('fighter',bundle,options.level||12)};
  if(name==='engine/modes/index.js')return {...exports,safeCheck:(mode,bundle,level)=>cachedCheck(mode.id,bundle,level)};
  if(name==='engine/sandbox.js')return {...exports,createBrain:(brain,options={})=>{
    const result=loads.get(stable([brain,options.lib||null]));
    if(!result)throw new Error('Brain load validation is not prepared');
    return structuredClone(result);
  }};
  return exports;
}
async function validate(job){
  const key=stable(job);if(checks.has(key))return;
  const id=++sequence;
  const result=await new Promise(resolve=>{validations.set(id,resolve);send({type:'validate',id,job});});
  checks.set(key,result);
  if(result.load)loads.set(stable([job.snapshot.brain,job.snapshot.lib]),result.load);
  // Only recent immutable validation inputs are retained. Every operation warms
  // current, previous and starter builds before it can use a cached check.
  while(checks.size>256)checks.delete(checks.keys().next().value);
  while(loads.size>256)loads.delete(loads.keys().next().value);
}
async function prepareValidation(message={}){
  const config=environment.load('config.json'),modes=environment.load('engine/modes/index.js'),loader=environment.load('engine/loader.js');
  const saved=serverHooks?.current().state||JSON.parse(environment.files.get('data/state.json')||'null')||{mode:'fighter',round:1};
  let body={};try{body=JSON.parse(message.body||'{}');}catch{}
  const desired=message.session?{mode:message.session.mode,round:message.session.round}
    :message.url==='/api/host/new-match'?{mode:body.mode||saved.mode,round:1}
    :message.url==='/api/host/next'?{mode:saved.mode,round:Math.min(12,saved.round+1)}:saved;
  const jobs=new Map();
  const add=(mode,snapshot,level)=>{const job=validationJob(mode,snapshot,level);jobs.set(stable(job),job);};
  for(const state of [saved,desired]){
    const mode=state.mode||'fighter',level=Math.min(12,Math.max(1,state.round||1)),m=modes.get(mode);
    if(mode!=='fighter'&&!m)continue;
    const snapshot=dir=>m?modes.snapshotOf(modes.readBundle(dir,m)):loader.snapshotOf(loader.readBundle(dir));
    add(mode,m?{design:m.starter[m.designFile],brain:m.starter[m.brainFile]}:snapshot('engine/starter'),level);
    for(const fighter of config.fighters){
      add(mode,snapshot('fighters/'+fighter.id),level);
      if(saved.matchId&&mode===saved.mode)for(const round of [saved.round-1,saved.round]){
        if(round<1)continue;
        const dir='data/matches/'+saved.matchId+'/round-'+round+'/'+fighter.id;
        if(environment.fs.existsSync(dir)){
          add(mode,snapshot(dir),level);
          add(mode,snapshot(dir),round);
        }
      }
    }
  }
  if(message.session){
    const {mode,round,builds}=message.session,m=modes.get(mode);
    for(const files of builds||[])if(files&&Object.keys(files).length){
      let fighter=null;if(!m)try{fighter=JSON.parse(files['fighter.json']);}catch{}
      const lib=Object.fromEntries(Object.entries(files).filter(([name])=>name.startsWith('lib/')).map(([name,text])=>[name.slice(4),text]));
      add(mode,m?{design:files[m.designFile],brain:files[m.brainFile],lib,notes:files['notes.md']}
        :{fighter,brain:files['brain.js'],lib,sprite:files['sprite.json'],notes:files['notes.md']},round);
    }
  }
  for(const job of jobs.values())await validate(job);
}
class SimulationWorker {
  constructor(file,{workerData}) {
    this.id=++sequence;this.handlers={};simulations.set(this.id,this);
    send({type:'simulate',id:this.id,job:workerData,matchId:serverHooks?.current().state.matchId});
  }
  once(name,handler){this.handlers[name]=handler;return this;}
  terminate(){simulations.delete(this.id);send({type:'cancel-simulation',id:this.id});}
}
const HOOKS = `
module.exports = {
  current: () => ({state:publicState(),match:matchPublic()}),
  flush: () => { saveState();saveFeeds();saveMatch(); },
  lockedFiles: () => IDS.map(id => {
    const snap=locked[id]?.snapshot;
    if(!snap)throw new Error('Both original builds must be locked first');
    const m=M();
    const files=m?{[m.designFile]:snap.design,[m.brainFile]:snap.brain}:{'fighter.json':JSON.stringify(snap.fighter,null,2),'brain.js':snap.brain};
    for(const [name,text] of Object.entries(snap.lib||{}))files['lib/'+name]=text;
    if(snap.sprite)files['sprite.json']=typeof snap.sprite==='string'?snap.sprite:JSON.stringify(snap.sprite);
    if(snap.notes)files['notes.md']=snap.notes;
    return files;
  }),
  syncSession(session, reset, restart) {
    if (reset || state.mode !== session.mode) newMatch({mode:session.mode});
    if (restart || state.round !== session.round) startBuilding(session.round);
    for(let side=0;side<2;side++) {
      const id=IDS[side], files=session.builds[side];
      if(state.phase==='building' && files && Object.keys(files).length) {
        const dir=comms.paths.fighterDir(id);
        const currentNames=fs.readdirSync(dir).filter(name=>/^(?:fighter|army|forces|company)\\.json$|^(?:brain|commander|strategy)\\.js$|^sprite\\.json$|^notes\\.md$/.test(name));
        const libDir=path.join(dir,'lib');
        if(fs.existsSync(libDir))currentNames.push(...fs.readdirSync(libDir).map(name=>'lib/'+name));
        let changed=false;
        for(const name of currentNames) if(!(name in files)){fs.rmSync(path.join(dir,name),{force:true});changed=true;}
        for(const [name,text] of Object.entries(files)) {const file=path.join(dir,name);if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===text)continue;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);changed=true;}
        if(changed)refreshLive(id,{force:true});
      }
      if(session.ready[side] && !state.fighters[id].ready && state.phase==='building') {
        const bundle=M()?modes.readBundle(comms.paths.fighterDir(id),M()):readBundle(comms.paths.fighterDir(id));
        handleReady(id,{matchId:state.matchId,round:state.round,nonce:'mcp-'+session.revision,snapshot:M()?modes.snapshotOf(bundle):snapshotOf(bundle)});
      }
    }
    if(session.phase==='ready'&&!IDS.every(id=>state.fighters[id].ready))throw new Error('The original engine rejected a locked build. Correct the visible validation errors and submit again.');
    if(session.phase==='complete'&&state.phase!=='match_over')endMatch('host ended the account match');
    broadcastAll();
    return {ok:true};
  }
};
`;
async function handleMessage(event) {
  const message=event.data;
  try {
    if(message.type==='ping'){send({type:'pong',nonce:message.nonce});return;}
    if(message.type==='validation-result'){
      const resolve=validations.get(message.id);if(resolve){validations.delete(message.id);resolve(message.result);}return;
    }
    if(message.type==='init') {
      const sources={...ORIGINAL_SOURCES,'server.js':ORIGINAL_SOURCES['server.js']+'\n'+HOOKS};
      environment=originalEnvironment(sources,{files:message.files,workerThreads:{Worker:SimulationWorker},noBrainExecution:true,mapModule:mapServerModule});
      await prepareValidation();
      serverHooks=environment.load('server.js');
      await environment.request('/events','GET','',chunk=>send({type:'sse',chunk}));
      send({type:'initialized'});
      return;
    }
    if(message.type==='simulation-result') {
      const worker=simulations.get(message.id);if(!worker)return;
      simulations.delete(message.id);
      worker.handlers.message?.(message.result);
      return;
    }
    if(message.type==='request') {
      if(message.method==='POST')await prepareValidation(message);
      const response=await environment.request(message.url,message.method,message.body);
      send({type:'response',id:message.id,response});
      return;
    }
    if(message.type==='locked-files') {
      send({type:'response',id:message.id,response:serverHooks.lockedFiles()});return;
    }
    if(message.type==='snapshot') {
      serverHooks.flush();send({type:'response',id:message.id,response:environment.snapshot()});return;
    }
    if(message.type==='session') {
      await prepareValidation(message);
      const result=serverHooks.syncSession(message.session,message.reset,message.restart);
      send({type:'response',id:message.id,response:{status:200,body:JSON.stringify(result)}});
    }
  } catch(error) {
    send({type:'failure',id:message.id,error:String(error.message||error).slice(0,1000)});
  }
}
let commandQueue=Promise.resolve();
self.onmessage=event=>{
  if(['ping','validation-result','simulation-result'].includes(event.data?.type))return handleMessage(event);
  commandQueue=commandQueue.then(()=>handleMessage(event));
  return commandQueue;
};
