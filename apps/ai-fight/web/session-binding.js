export const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export function snapshotFromFiles(mode,files){
  if(!files)return null;
  const lib=Object.fromEntries(Object.entries(files).filter(([name])=>name.startsWith('lib/')).map(([name,text])=>[name.slice(4),text]));
  const common={brain:files[mode==='fighter'?'brain.js':mode==='business'?'strategy.js':'commander.js']??null,lib:Object.keys(lib).length?lib:null,notes:files['notes.md']??null};
  if(mode==='fighter')return {...common,fighter:JSON.parse(files['fighter.json']),sprite:files['sprite.json']??null};
  return {...common,mode,design:files[mode==='army'?'army.json':mode==='war'?'forces.json':'company.json']??null};
}
export function sameSnapshot(mode,a,b){
  const clean=snapshot=>{
    const result={...snapshot,lib:snapshot.lib&&Object.keys(snapshot.lib).length?snapshot.lib:null,notes:snapshot.notes??null};
    if(mode==='fighter'){
      result.sprite=snapshot.sprite??null;
      if(typeof result.sprite==='string')try{result.sprite=JSON.parse(result.sprite);}catch{}
    }else result.mode=mode;
    return result;
  };
  return !!a&&!!b&&stable(clean(a))===stable(clean(b));
}
export function sessionStillMatches(target,session,id,generation){
  return !!target&&!!session&&target.id===id&&target.id===session.id&&target.generation===generation&&target.round===session.round&&target.revision===session.revision&&session.phase==='ready'&&target.buildKey===stable(session.builds);
}
