// Node compatibility lives only in a network-isolated browser Worker. It has no
// disk, process, credential or network access. Original sources stay unchanged.
function originalEnvironment(sourceFiles, options = {}) {
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const normalize = value => {
    const parts = [];
    for (const part of String(value).replace(/\\/g,'/').split('/')) {
      if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part);
    }
    return parts.join('/');
  };
  const path = {join:(...p)=>normalize(p.join('/')),resolve:(...p)=>normalize(p.join('/')),
    normalize,dirname:p=>normalize(p).split('/').slice(0,-1).join('/'),basename:p=>normalize(p).split('/').pop(),
    extname:p=>{const name=String(p).split('/').pop();return name.includes('.')?'.'+name.split('.').pop():'';}};
  class BrowserBuffer extends Uint8Array {
    static alloc(n) { return new BrowserBuffer(n); }
    static from(value) { return new BrowserBuffer(typeof value==='string'?encoder.encode(value):value); }
    static byteLength(value) { return encoder.encode(String(value)).length; }
    toString(encoding,start=0,end=this.length) { const b=this.slice(start,end);return encoding==='hex'?[...b].map(n=>n.toString(16).padStart(2,'0')).join(''):decoder.decode(b); }
    readUInt32LE(offset) {return new DataView(this.buffer,this.byteOffset,this.byteLength).getUint32(offset,true);}
  }
  const Buffer = BrowserBuffer;
  const originals = new Map(Object.entries(sourceFiles));
  const files = new Map(Object.entries(options.files || {}));
  const directories = new Set(['']);
  const modified = new Map();
  let total = [...files.values()].reduce((sum,text)=>sum+Buffer.byteLength(text),0);
  function mkdir(dir) { let current='';for(const part of normalize(dir).split('/')) { current=current?current+'/'+part:part;directories.add(current); } }
  for(const name of [...originals.keys(),...files.keys()]) mkdir(path.dirname(name));
  const missing = () => Object.assign(new Error('Virtual file not found'),{code:'ENOENT'});
  const read = name => {const key=normalize(name);if(files.has(key)) return files.get(key);if(originals.has(key)) return originals.get(key);throw missing();};
  const allNames = () => [...new Set([...originals.keys(),...files.keys(),...directories])];
  const write = (name,value) => {
    const key=normalize(name), text=typeof value==='string'?value:decoder.decode(value);
    const next=total-Buffer.byteLength(files.get(key)||'')+Buffer.byteLength(text);
    if(next>64*1024*1024 || (!files.has(key)&&files.size>=3000)) throw new Error('Browser match storage limit reached; download results before starting a new match');
    total=next;mkdir(path.dirname(key));files.set(key,text);modified.set(key,Date.now());
  };
  const fs = {
    readFileSync:(name,encoding)=>encoding?read(name):Buffer.from(read(name)),
    writeFileSync:write,appendFileSync:(name,text)=>write(name,(fs.existsSync(name)?read(name):'')+text),
    mkdirSync:mkdir,existsSync:name=>{const key=normalize(name);return files.has(key)||originals.has(key)||directories.has(key);},
    statSync(name) {const key=normalize(name);if(!fs.existsSync(key))throw missing();const dir=directories.has(key)&&!files.has(key)&&!originals.has(key);return {size:dir?0:Buffer.byteLength(read(key)),mtimeMs:modified.get(key)||0,isFile:()=>!dir,isDirectory:()=>dir};},
    readdirSync(name,opts) {const prefix=normalize(name);if(!fs.existsSync(prefix))throw missing();const start=prefix?prefix+'/':'';
      const names=[...new Set(allNames().filter(n=>n.startsWith(start)&&n!==prefix).map(n=>n.slice(start.length).split('/')[0]))];
      return opts?.withFileTypes?names.map(n=>({name:n,isDirectory:()=>directories.has(start+n),isFile:()=>!directories.has(start+n)})):names;},
    unlinkSync(name) {const key=normalize(name);if(!files.has(key))throw missing();total-=Buffer.byteLength(files.get(key));files.delete(key);},
    copyFileSync:(from,to)=>write(to,read(from)),
    renameSync(from,to) {const a=normalize(from),b=normalize(to);if(files.has(a)){write(b,read(a));fs.unlinkSync(a);return;}if(!directories.has(a))throw missing();
      mkdir(b);for(const [key,text] of [...files])if(key.startsWith(a+'/')){write(b+key.slice(a.length),text);fs.unlinkSync(key);}for(const key of [...directories])if(key===a||key.startsWith(a+'/')){directories.delete(key);mkdir(b+key.slice(a.length));}},
    rmSync(name) {const key=normalize(name);for(const f of [...files.keys()])if(f===key||f.startsWith(key+'/'))fs.unlinkSync(f);for(const d of [...directories])if(d===key||d.startsWith(key+'/'))directories.delete(d);},
    cpSync(from,to) {const a=normalize(from),b=normalize(to);for(const key of allNames())if(key.startsWith(a+'/')&&!directories.has(key))write(b+key.slice(a.length),read(key));},
    stat(name,cb) {try{cb(null,fs.statSync(name));}catch(error){cb(error);}},
    createReadStream(name,range) {return {pipe(res){const text=read(name);res.end(range?text.slice(range.start,range.end+1):text);}};},
    openSync:name=>normalize(name),closeSync:()=>{},
    readSync(fd,buffer,offset,length,position) {const bytes=encoder.encode(read(fd)).slice(position,position+length);buffer.set(bytes,offset);return bytes.length;},
  };
  const process = {env:{},pid:1,argv:[],platform:'browser',on:()=>{},exit:()=>{},
    hrtime:{bigint:()=>BigInt(Math.floor(performance.now()*1e6))}};
  const vm = {
    createContext(sandbox) {const math=Object.create(null);Object.defineProperties(math,Object.getOwnPropertyDescriptors(Math));const context=Object.assign(sandbox,{Math:math});context.globalThis=context;return context;},
    Script:class {constructor(source){this.source=String(source);new Function(this.source);}
      runInContext(context){if(options.noBrainExecution)throw new Error('Brain execution is forbidden in the persistent server');const code=/^\s*\(function\b/.test(this.source)?`return ${this.source.trim()}`:this.source+'\nif(typeof brain==="function")globalThis.brain=brain;if(typeof command==="function")globalThis.command=command;if(typeof decide==="function")globalThis.decide=decide;';return new Function('context',`with(context){return(function(){${code}\n}).call(context);}`)(context);}}
  };
  let requestHandler;
  const http={createServer(handler){requestHandler=handler;return {on:()=>{},listen(port,host,cb){cb();}};}};
  const cryptoModule={randomBytes(n){const result=new Buffer(n);crypto.getRandomValues(result);return result;}};
  const cache=new Map();
  function load(name,parent='') {
    const builtin={fs,path,vm,http,crypto:cryptoModule,worker_threads:options.workerThreads,child_process:{spawn(){throw new Error('Process execution unavailable in browser');}}};
    if(Object.hasOwn(builtin,name))return builtin[name];
    let key=normalize(name.startsWith('.')?path.join(path.dirname(parent),name):name);
    if(!originals.has(key)){if(originals.has(key+'.js'))key+='.js';else if(originals.has(key+'/index.js'))key+='/index.js';}
    if(!originals.has(key))throw new Error('Original module unavailable: '+key);
    if(cache.has(key))return cache.get(key).exports;
    const module={exports:{}};cache.set(key,module);
    if(key.endsWith('.json'))module.exports=JSON.parse(originals.get(key));
    else new Function('require','module','exports','__dirname','Buffer','process','setImmediate',originals.get(key))(
      n=>load(n,key),module,module.exports,path.dirname(key),Buffer,process,fn=>setTimeout(fn,0));
    if(options.mapModule)module.exports=options.mapModule(key,module.exports);
    return module.exports;
  }
  async function request(url,method='GET',body='',stream) {
    return new Promise((resolve,reject)=>{
      let status=200,headers={},chunks='';const handlers={};
      const req={url,method,headers:{},on(name,fn){handlers[name]=fn;},destroy(){reject(new Error('Request too large'));}};
      const res={writeHead(code,values){status=code;headers=values;},write(text){if(stream)stream(String(text));else chunks+=text;},end(text=''){resolve({status,headers,body:chunks+text});}};
      try{requestHandler(req,res);if(handlers.data&&body)handlers.data(body);handlers.end?.();if(stream)resolve({status,headers});}catch(error){reject(error);}
    });
  }
  return {load,fs,files,request,snapshot:()=>Object.fromEntries(files)};
}
