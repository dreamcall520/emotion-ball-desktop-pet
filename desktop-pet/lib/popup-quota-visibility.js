const path=require('node:path');
const {fileURLToPath,pathToFileURL}=require('node:url');
const POPUPS=new Set(['global-settings','customize','chat','api-usage','about','codex-consent','workbuddy-consent','codex-details','workbuddy-details','api-balance-details','quota-guard']);
const CARDS=new Set(['quota-label','api-usage-label','workbuddy-label','api-balance-label','workbuddy-guard-entry','quota-card-group','quota-card-transition','weather']);
function createPopupQuotaVisibility({root,ipcMain,onChange=()=>{},onError=()=>{},schedule=fn=>setImmediate(fn),cancel=clearImmediate}){
  root=path.resolve(root);
  const windows=new Map(),leases=new Set();let blocked=false,releaseTimer=null,shortcutRelease=null;
  function role(url,preload){
    try{
      const parsed=new URL(url),file=fileURLToPath(parsed),name=path.basename(file,'.html');
      if(path.dirname(file)!==root||path.extname(file)!=='.html')return null;
      const expected=path.join(root,name==='codex-details'?'codex-details-preload.js':name+'-preload.js');
      if(preload&&path.resolve(preload)!==expected)return null;
      if(CARDS.has(name))return 'card';
      if(POPUPS.has(name))return 'popup';
      if(name==='shortcuts')return 'shortcut';
      if(name==='notes')return parsed.searchParams.get('mode')==='panel'?'popup':['note','reminder'].includes(parsed.searchParams.get('mode'))?'passive':null;
      if(name==='pomodoro')return parsed.searchParams.get('view')==='panel'?'popup':['mini','message'].includes(parsed.searchParams.get('view'))?'passive':null;
    }catch(_){}
    return null;
  }
  const hasBlockers=()=>leases.size>0||[...windows.values()].some(r=>!r.ended&&!r.minimized&&(r.role==='popup'&&(r.pending||r.visible)||r.modal&&r.visible));
  function hideCards(){for(const r of windows.values())if(r.role==='card'&&!r.ended&&!r.win.isDestroyed()){try{r.nativeHide?.();}catch(error){onError(error);}}}
  function update(){
    if(hasBlockers()){
      if(releaseTimer!==null){cancel(releaseTimer);releaseTimer=null;}
      if(!blocked){blocked=true;hideCards();onChange(true);}
    }else if(blocked&&releaseTimer===null){releaseTimer=schedule(()=>{releaseTimer=null;if(!hasBlockers()){
      blocked=false;
      for(const r of windows.values())if(r.suppressedOpacity!==null&&!r.ended&&!r.win.isDestroyed()){
        try{r.nativeHide?.();if(!r.win.isDestroyed())r.nativeOpacity?.(r.suppressedOpacity);}
        catch(error){onError(error);}
        finally{r.suppressedOpacity=null;}
      }
      onChange(false);
    }});}
  }
  function acquire(){const token={};leases.add(token);update();let done=false;return()=>{if(!done){done=true;leases.delete(token);update();}};}
  function track(win){
    if(windows.has(win)||win.isDestroyed())return;
    const contents=win.webContents,preload=contents.getLastWebPreferences?.()?.preload;
    const r={win,contents,role:null,url:'',pending:false,visible:win.isVisible?.()===true,minimized:false,modal:false,ended:false,loadToken:0,suppressedOpacity:null,nativeOpacity:win.setOpacity?.bind(win),nativeHide:typeof win.hide==='function'?win.hide.bind(win):null};windows.set(win,r);
    const setURL=url=>{r.url=url;r.role=role(url,preload);};
    if(preload){const name=path.basename(preload,'-preload.js');if(CARDS.has(name)&&path.dirname(preload)===root)r.role='card';}
    function wrap(name,handler){if(typeof win[name]!=='function')return;const native=win[name].bind(win);win[name]=(...args)=>handler(native,args);}
    function loading(native,args,url){
      const token=++r.loadToken;setURL(url);r.pending=r.role==='popup';r.modal=false;update();
      try{const result=native(...args);if(result?.then)result.catch(()=>{if(!r.ended&&r.loadToken===token){r.pending=false;update();}});return result;}
      catch(error){if(r.loadToken===token){r.pending=false;update();}throw error;}
    }
    wrap('loadFile',(native,args)=>{const u=new URL(pathToFileURL(path.resolve(args[0])));for(const [key,value]of Object.entries(args[1]?.query||{}))u.searchParams.set(key,value);return loading(native,args,u.href);});
    wrap('loadURL',(native,args)=>loading(native,args,args[0]));
    wrap('setOpacity',(native,args)=>{
      if(r.role==='card'&&blocked&&args[0]>0){r.suppressedOpacity=args[0];return native(0);}
      return native(...args);
    });
    for(const name of ['show','showInactive','restore'])wrap(name,(native,args)=>{
      if(r.role==='card'&&blocked&&win.getOpacity?.()!==0){r.nativeHide?.();return;}
      r.visible=true;r.pending=false;r.minimized=false;update();return native(...args);
    });
    wrap('hide',(native,args)=>{r.visible=false;r.pending=false;r.loadToken++;update();return native(...args);});
    win.on('show',()=>{if(r.role==='card'&&blocked&&win.getOpacity?.()!==0){r.nativeHide?.();return;}r.visible=true;r.pending=false;r.minimized=false;update();});
    win.on('hide',()=>{r.visible=false;r.pending=false;update();});
    win.on('minimize',()=>{r.minimized=true;r.pending=false;update();});
    win.on('restore',()=>{if(r.role==='card'&&blocked){r.nativeHide?.();return;}r.minimized=false;r.visible=true;update();});
    win.once('closed',()=>{r.ended=true;windows.delete(win);update();});
    contents.on('did-fail-load',(_event,code,_description,url,isMainFrame)=>{if(isMainFrame&&code!==-3&&url===r.url){r.pending=false;update();}});
    contents.on('render-process-gone',()=>{r.pending=false;r.visible=false;r.modal=false;update();});
  }
  ipcMain?.on('pet:quota-modal',(event,value)=>{
    const r=[...windows.values()].find(r=>!r.ended&&!r.win.isDestroyed()&&event.sender===r.contents&&event.senderFrame===r.contents.mainFrame);
    const actual=r&&role(event.senderFrame?.url||r.contents.getURL?.(),r.contents.getLastWebPreferences?.()?.preload);
    const valid=Boolean(r&&actual&&typeof value==='boolean');
    if(valid){r.modal=value;update();}event.returnValue=valid;
  });
  return{track,acquire,isBlocked:()=>blocked,
    cancelPending(){for(const r of windows.values())if(r.pending&&!r.visible){r.pending=false;r.loadToken++;}update();},
    setShortcutPresenting(value){if(value&&!shortcutRelease)shortcutRelease=acquire();else if(!value&&shortcutRelease){const release=shortcutRelease;shortcutRelease=null;release();}}};
}
function createQuotaDialogProxy(native,registry){
  const cache=new Map();
  return new Proxy(native,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function'||!String(key).startsWith('show'))return value;
    if(cache.get(key)?.native!==value){const wrapped=(...args)=>{const release=registry.acquire();try{const result=value.apply(target,args);if(result?.then)return Promise.resolve(result).finally(release);release();return result;}catch(error){release();throw error;}};cache.set(key,{native:value,wrapped});}return cache.get(key).wrapped;
  }});
}
module.exports={createPopupQuotaVisibility,createQuotaDialogProxy};
