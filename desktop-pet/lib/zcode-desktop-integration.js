'use strict';
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createZcodeDesktopEventBridge}=require('./zcode-desktop-event-bridge');
const FILES=['.claude-plugin/marketplace.json','plugins/qiuqiu-zcode-task-events/.zcode-plugin/plugin.json','plugins/qiuqiu-zcode-task-events/hooks/hooks.json','plugins/qiuqiu-zcode-task-events/scripts/emit-metadata.sh'];
const fail=code=>Object.assign(new Error(code),{code});
function createZcodeDesktopIntegration({root,assetRoot,onChange=()=>{},createBridge=createZcodeDesktopEventBridge}={}){
 if(!path.isAbsolute(root||'')||!path.isAbsolute(assetRoot||''))throw fail('INVALID_INPUT');
 const configFile=path.join(root,'grant.json'),market=path.join(root,'marketplace'),receiver=path.join(market,'plugins/qiuqiu-zcode-task-events/receiver.json');
 let bridge=null,closed=false,flight=null,epoch=0,error=null,installationAt=null;
 const installationFile=path.join(root,'installation-observed.json');
 function readInstallation(){let fd;try{fd=fs.openSync(installationFile,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>1024)return null;const value=JSON.parse(fs.readFileSync(fd,'utf8'));return value.version===1&&Number.isSafeInteger(value.observedAt)&&value.observedAt>0?value.observedAt:null;}catch{return null;}finally{if(fd!==undefined)fs.closeSync(fd);}}
 function read(){let fd;try{fd=fs.openSync(configFile,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const s=fs.fstatSync(fd);if(!s.isFile()||s.size>8192)throw fail('INVALID_GRANT');const value=JSON.parse(fs.readFileSync(fd,'utf8'));if(value?.version!==1||value.enabled!==true||typeof value.endpoint!=='string'||typeof value.token!=='string')throw fail('INVALID_GRANT');const u=new URL(value.endpoint);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.pathname!=='/zcode/events'||u.username||u.password||u.search||u.hash)throw fail('INVALID_GRANT');return value;}catch(e){if(e.code==='ENOENT')return null;throw fail('INVALID_GRANT');}finally{if(fd!==undefined)fs.closeSync(fd);}}
 function directory(dir){const relative=path.relative(root,dir);if(relative.startsWith('..')||path.isAbsolute(relative))throw fail('UNSAFE_CONFIG');fs.mkdirSync(root,{recursive:true,mode:0o700});if(fs.lstatSync(root).isSymbolicLink())throw fail('UNSAFE_CONFIG');let current=root;for(const part of relative.split(path.sep).filter(Boolean)){current=path.join(current,part);try{const stat=fs.lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw fail('UNSAFE_CONFIG');}catch(e){if(e.code!=='ENOENT')throw e;fs.mkdirSync(current,{mode:0o700});}}}
 function atomic(file,value){directory(path.dirname(file));const temporary=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temporary,JSON.stringify(value),{mode:0o600,flag:'wx'});fs.renameSync(temporary,file);}finally{try{fs.unlinkSync(temporary);}catch(_){}}}
 function getState(){const state=bridge?.getState()||{enabled:false,status:'disabled',scope:'authorized-original-zcode-hook-metadata',observations:[]};return{...state,error,pluginInstallationVerified:installationAt!==null,pluginLastVerifiedAt:installationAt,mainReplyTerminalVerified:state.observations.some(row=>row.terminalConfirmed===true&&row.terminalKind==='main-reply'),terminalTaskStateVerified:false,overallTaskVerified:false};}
 function notify(){const observed=bridge?.getState().lastEventAt;if(!closed&&Number.isSafeInteger(observed)&&observed>0&&observed!==installationAt){try{atomic(installationFile,{version:1,observedAt:observed});installationAt=observed;}catch{/* A disk failure must not interrupt the original task or claim persisted verification. */}}if(!closed)onChange(getState());}
 function start({approved=false,restore=false}={}){
  if(closed)return Promise.reject(fail('CLOSED'));if(flight)return flight;
  const currentEpoch=epoch;
  const promise=Promise.resolve().then(async()=>{
   if(!approved&&!restore)throw fail('CONSENT_REQUIRED');
   const old=read();if(restore&&!old)return{status:'not-enabled'};installationAt=old?readInstallation():null;
   if(closed||epoch!==currentEpoch)throw fail('CLOSED');
   const current=bridge||createBridge({onChange:notify});bridge=current;
   try{
    const config=await current.start(old?{port:Number(new URL(old.endpoint).port),token:old.token}:{});
    if(closed||epoch!==currentEpoch){await current.close();throw fail('CLOSED');}
    if(approved){
     directory(market);
     for(const rel of FILES){const source=path.join(assetRoot,rel),stat=fs.lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024)throw fail('INVALID_PLUGIN_ASSET');const dest=path.join(market,rel);directory(path.dirname(dest));try{if(fs.lstatSync(dest).isSymbolicLink())throw fail('UNSAFE_CONFIG');}catch(e){if(e.code!=='ENOENT')throw e;}fs.copyFileSync(source,dest);fs.chmodSync(dest,rel.endsWith('.sh')?0o700:0o600);}
     atomic(receiver,config);atomic(configFile,config);
    }
    error=null;notify();return{status:'prepared',marketplaceDirectory:market};
   }catch(e){await current.close();if(bridge===current)bridge=null;error=e.code==='BRIDGE_PORT_UNAVAILABLE'?'本机事件连接暂被占用，请稍后重试。':'本机事件连接未完成，尚未安装或启用插件。';notify();throw fail(e.code||'BRIDGE_START_FAILED');}
  }).finally(()=>{if(flight===promise)flight=null;});flight=promise;return promise;
 }
 async function revoke(){epoch++;const current=bridge;bridge=null;await current?.close();installationAt=null;let cleanupError=null;for(const file of [installationFile,configFile]){try{fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT')cleanupError=e;}}try{if(fs.existsSync(receiver))atomic(receiver,{version:1,enabled:false});}catch(e){cleanupError=e;}error=cleanupError?'接收已停止，但本机授权清理未完成，请重试。':null;notify();if(cleanupError)throw fail('GRANT_CLEANUP_FAILED');}
 async function close(){if(closed)return;closed=true;epoch++;const current=bridge;bridge=null;await current?.close();}
 return{prepare:()=>start({approved:true}),restore:()=>start({restore:true}),getState,revoke,close,getMarketplaceDirectory:()=>market};
}
module.exports={createZcodeDesktopIntegration,FILES};
