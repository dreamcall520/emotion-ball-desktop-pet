'use strict';
const PROVIDERS = new Set(['codex', 'zcode', 'workbuddy']);
// One user action owns the system picker and the following checks. Background
// restoration never requests new permissions or opens a sign-in window.
function createMasEnableFlow({ ensureDirectory, refreshData, connectChat, revoke, onChange = () => {} }) {
  const states = Object.fromEntries([...PROVIDERS].map(p => [p, { status:'idle', step:null, message:'尚未启用', chat:{status:'unavailable',message:'尚未连接'} }]));
  let flight = null, closed = false, revision = 0;
  const getState = () => structuredClone(states);
  function update(provider, patch, epoch) { if (closed || epoch !== revision) return; states[provider] = {...states[provider],...patch}; onChange(); }
  function enable(provider, { interactive = true } = {}) {
    if (!PROVIDERS.has(provider)) return Promise.reject(Object.assign(new Error('INVALID_PROVIDER'),{code:'INVALID_PROVIDER'}));
    if (closed) return Promise.reject(Object.assign(new Error('CLOSED'),{code:'CLOSED'}));
    if (flight) return flight.provider===provider ? flight.promise : Promise.reject(Object.assign(new Error('BUSY'),{code:'BUSY'}));
    const epoch = revision;
    const promise = Promise.resolve().then(async () => {
      update(provider,{status:'working',step:'permission',message:interactive?'正在检查授权…':'正在恢复连接…'},epoch);
      try {
        const directory = await ensureDirectory(provider,{interactive});
        if (closed || epoch!==revision) return;
        if (directory.status!=='stored') {
          update(provider,{status:directory.status==='cancelled'?'cancelled':'partial',step:null,message:directory.status==='cancelled'?'已取消，保留已有连接。':'首次使用请点启用授权。'},epoch);return;
        }
        update(provider,{step:'checking',message:'授权已确认，正在检查可用功能…'},epoch);
        let data;
        try { data=await refreshData(provider,{interactive}); }
        catch (_) { data={available:false,message:'数据暂未读取成功，请稍后重试启用。'}; }
        if (closed || epoch!==revision) return;
        let chat;
        try { chat=await connectChat(provider,{interactive}); }
        catch (_) { chat={status:'unavailable',message:'聊天暂未连接，可稍后重试。'}; }
        if (closed || epoch!==revision) return;
        update(provider,{status:data?.available && chat?.status==='ready'?'ready':'partial',step:null,message:data?.message||'授权已保存。',chat:chat||{status:'unavailable',message:'聊天接入尚未完成。'}},epoch);
      } catch (error) {
        update(provider,{status:'error',step:null,message:error?.code==='DIRECTORY_ACCESS_REQUIRED'?'授权已失效，请重新启用并确认系统授权。':'本次启用未完成，请重试。'},epoch);
      }
    }).finally(()=>{if(flight?.promise===promise)flight=null;});
    flight={provider,promise};return promise;
  }
  function disable(provider) {
    if (!PROVIDERS.has(provider)) return Promise.reject(Object.assign(new Error('INVALID_PROVIDER'),{code:'INVALID_PROVIDER'}));
    if(flight)return Promise.reject(Object.assign(new Error('BUSY'),{code:'BUSY'}));
    const epoch=++revision;
    update(provider,{status:'working',step:'revoking',message:'正在撤销授权…'},epoch);
    const promise=Promise.resolve().then(()=>revoke(provider)).then(()=>{
      if(closed||epoch!==revision)return;
      states[provider]={status:'idle',step:null,message:'已停用并撤销本地数据授权。',chat:{status:'unavailable',message:'聊天已断开'}};onChange();
    }).finally(()=>{if(flight?.promise===promise)flight=null;});
    flight={provider,promise};return promise;
  }
  async function restore(provider){if(flight)await flight.promise;if(!closed)return enable(provider,{interactive:false});}
  function close(){closed=true;revision++;}
  return {getState,enable,restore,disable,close};
}
module.exports={createMasEnableFlow};
