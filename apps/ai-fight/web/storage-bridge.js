export function storageRequest(action,args){
  if(parent===window)return Promise.reject(new Error('Open AI Fight inside Batchly to restore its saved game.'));
  const requestId=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const finish=(error,result)=>{clearTimeout(timer);removeEventListener('message',receive);if(error)reject(error);else resolve(result);};
    const receive=event=>{
      const production=['https://batch-ly.com','https://www.batch-ly.com'].includes(event.origin);
      const localTest=location.hostname==='127.0.0.1'&&event.origin===new URL(import.meta.url).origin;
      if(event.source!==parent||(!production&&!localTest)||event.data?.type!=='ai-fight-storage-response'||event.data.requestId!==requestId)return;
      const result=event.data.result;
      if(!result?.ok)return finish(new Error(result?.error||'The saved game could not be accessed. Reload before continuing.'));
      if(!Number.isSafeInteger(result.revision)||result.revision<0)return finish(new Error('Invalid saved-game revision'));
      if(action==='load'&&result.files!==null&&(!result.files||typeof result.files!=='object'||Array.isArray(result.files)))return finish(new Error('Invalid saved-game data'));
      finish(null,result);
    };
    const timer=setTimeout(()=>finish(new Error('The saved-game host is unavailable. Reload before continuing; no saved files were overwritten.')),10000);
    addEventListener('message',receive);
    parent.postMessage({type:'ai-fight-storage-request',requestId,action,args},'*');
  });
}

export function validateSnapshot(files){
  if(!files||typeof files!=='object'||Array.isArray(files))throw new Error('Invalid saved-game file map');
  const entries=Object.entries(files);
  if(entries.length>3000||entries.some(([name,text])=>typeof text!=='string'||! /^(?:data|fighters|results|prompts)\/[A-Za-z0-9_./-]+$/.test(name)||name.split('/').some(part=>!part||part==='.'||part==='..'||['__proto__','prototype','constructor'].includes(part))))throw new Error('Invalid saved-game file path');
  if(new TextEncoder().encode(JSON.stringify(files)).length>64*1024*1024)throw new Error('Saved game exceeds the 64 MiB browser storage limit');
  return files;
}

export async function loadSavedFiles(){
  for(let attempt=0;attempt<8;attempt++){
    try{return await storageRequest('load',{});}catch(error){
      if(error.message!=='Account status is still loading. Try history load again.'||attempt===7)throw error;
      await new Promise(resolve=>setTimeout(resolve,500));
    }
  }
}
