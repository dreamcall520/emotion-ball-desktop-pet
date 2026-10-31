'use strict';
const path=require('node:path');
const PROVIDERS=new Set(['zcode','workbuddy']);
const MESSAGES={INVALID_PROVIDER:'不支持该工具的插件安装。',HOST_STATUS_UNAVAILABLE:'暂时无法确认原工具是否已经退出，请稍后重试。',HOST_NOT_INSTALLED:'请先安装对应的 AI 工具，再继续任务插件安装。',HOST_WAIT_TIMEOUT:'等待原工具退出已超时；请保存工作并退出后重试。',HOST_LAUNCH_UNAVAILABLE:'插件已处理，但暂时无法重新打开原工具，请本人打开。',CANCELLED:'已取消等待原工具退出。'};
function failure(code){return Object.assign(new Error(MESSAGES[code]||MESSAGES.HOST_STATUS_UNAVAILABLE),{code});}
function check(provider){if(!PROVIDERS.has(provider))throw failure('INVALID_PROVIDER');}
function createPluginHost({loadNative=()=>require(path.join(__dirname,'../native/plugin-host.node')),pollMs=1000,timeoutMs=900000}={}){
 if(typeof loadNative!=='function'||!Number.isSafeInteger(pollMs)||pollMs<1||pollMs>5000||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>900000)throw new TypeError('Invalid plugin host options');
 let loaded=false,binding;
 function native(){if(!loaded){loaded=true;try{binding=loadNative();}catch{binding=null;}}if(!binding||typeof binding.status!=='function'||typeof binding.launch!=='function')throw failure('HOST_STATUS_UNAVAILABLE');return binding;}
 function getStatus(provider){check(provider);try{const value=native().status(provider);if(!value||value.known!==true||typeof value.installed!=='boolean'||typeof value.running!=='boolean')throw failure('HOST_STATUS_UNAVAILABLE');return{known:true,installed:value.installed,running:value.running};}catch(error){throw failure(error?.code==='INVALID_PROVIDER'?'INVALID_PROVIDER':'HOST_STATUS_UNAVAILABLE');}}
 function isStopped(provider){const value=getStatus(provider);return value.known===true&&value.installed===true&&value.running===false;}
 function launch(provider){check(provider);try{const value=native().launch(provider);if(value?.requested!==true)throw failure('HOST_LAUNCH_UNAVAILABLE');return{requested:true};}catch(error){throw failure(error?.code==='HOST_NOT_INSTALLED'?'HOST_NOT_INSTALLED':'HOST_LAUNCH_UNAVAILABLE');}}
 async function waitUntilStopped(provider,{signal,onWaiting}={}){
  check(provider);if(signal?.aborted)throw failure('CANCELLED');const started=Date.now();let notified=false;
  for(;;){if(signal?.aborted)throw failure('CANCELLED');const current=getStatus(provider);if(!current.installed)throw failure('HOST_NOT_INSTALLED');if(!current.running)return current;if(!notified){notified=true;try{onWaiting?.({...current});}catch{}}if(signal?.aborted)throw failure('CANCELLED');const remaining=timeoutMs-(Date.now()-started);if(remaining<=0)throw failure('HOST_WAIT_TIMEOUT');await new Promise((resolve,reject)=>{let timer;const cancelled=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancelled);reject(failure('CANCELLED'));};timer=setTimeout(()=>{signal?.removeEventListener('abort',cancelled);resolve();},Math.min(pollMs,remaining));signal?.addEventListener('abort',cancelled,{once:true});if(signal?.aborted)cancelled();});}
 }
 return{getStatus,isStopped,waitUntilStopped,launch};
}
module.exports={createPluginHost};
