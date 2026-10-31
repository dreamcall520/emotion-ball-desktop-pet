'use strict';
const PROVIDERS = new Set(['codex', 'zcode', 'workbuddy']);
const failure=code=>Object.assign(new Error(code),{code});
// Chat owns its official login. Original-tool data is optional and independently
// authorized; background restoration never opens a picker or starts a new login.
function createMasEnableFlow({ ensureDirectory, refreshData, connectChat, revoke, onChange = () => {} }) {
  const initial=()=>({status:'idle',step:null,message:'尚未启用聊天',chat:{status:'unavailable',message:'尚未连接'},data:{status:'needs-authorization',message:'原工具任务与额度尚未授权（可选）'}});
  const states=Object.fromEntries([...PROVIDERS].map(p=>[p,initial()]));
  const revisions=Object.fromEntries([...PROVIDERS].map(p=>[p,0])),dataFlights=new Map();
  let flight=null,closed=false;
  const getState=()=>structuredClone(states);
  const valid=(provider,epoch)=>!closed&&epoch===revisions[provider];
  function update(provider,patch,epoch){if(!valid(provider,epoch))return;states[provider]={...states[provider],...patch};onChange();}
  function check(provider){if(!PROVIDERS.has(provider))throw failure('INVALID_PROVIDER');if(closed)throw failure('CLOSED');}
  function statusAfterData(provider){return states[provider].chat.status==='ready'?'ready':states[provider].data.status==='ready'?'partial':states[provider].status;}
  function readData(provider,{interactive=false}={}){
    if(closed)return Promise.resolve();
    const current=dataFlights.get(provider);if(current)return current;
    const epoch=revisions[provider];
    const promise=Promise.resolve().then(async()=>{
      update(provider,{data:{status:'working',message:interactive?'正在授权原工具任务与额度…':'正在恢复已授权的数据…'}},epoch);
      try{
        const directory=await ensureDirectory(provider,{interactive});if(!valid(provider,epoch))return;
        if(directory.status!=='stored'){
          update(provider,{data:{status:directory.status==='cancelled'?'cancelled':'needs-authorization',message:directory.status==='cancelled'?'已取消数据授权，聊天不受影响。':'原工具任务与额度尚未授权（可选）'}},epoch);return;
        }
        const result=await refreshData(provider,{interactive});if(!valid(provider,epoch))return;
        update(provider,{data:{status:result?.available?'ready':'unavailable',message:result?.message||'原工具数据暂未读取成功。'}},epoch);
        update(provider,{status:statusAfterData(provider)},epoch);
      }catch(error){update(provider,{data:{status:'error',message:error?.code==='DIRECTORY_ACCESS_REQUIRED'?'原工具数据授权已失效，请重新授权；聊天不受影响。':'原工具数据暂未读取成功，聊天不受影响。'}},epoch);}
    }).finally(()=>{if(dataFlights.get(provider)===promise)dataFlights.delete(provider);});
    dataFlights.set(provider,promise);return promise;
  }
  function enable(provider,{interactive=true}={}){
    try{check(provider);}catch(error){return Promise.reject(error);}
    if(flight)return flight.provider===provider&&flight.kind==='chat'?flight.promise:Promise.reject(failure('BUSY'));
    const epoch=revisions[provider];
    const promise=Promise.resolve().then(async()=>{
      update(provider,{status:'working',step:'chat',message:interactive?'正在连接聊天…':'正在恢复聊天…'},epoch);
      let chat;
      try{chat=await connectChat(provider,{interactive});}
      catch(_){chat={status:'unavailable',message:'聊天暂未连接，请稍后重试。'};}
      if(!valid(provider,epoch))return;
      chat=chat||{status:'unavailable',message:'聊天接入尚未完成。'};
      update(provider,{status:chat.status==='ready'?'ready':'partial',step:null,message:chat.message||'聊天尚未就绪。',chat},epoch);
      // Do not await quota/task queries: they cannot delay the login or make a
      // usable chat appear broken just because optional data was not authorized.
      void readData(provider,{interactive:false});
    }).finally(()=>{if(flight?.promise===promise)flight=null;});
    flight={provider,kind:'chat',promise};return promise;
  }
  function enableData(provider){
    try{check(provider);}catch(error){return Promise.reject(error);}
    if(flight)return flight.provider===provider&&flight.kind==='data'?flight.promise:Promise.reject(failure('BUSY'));
    const existing=dataFlights.get(provider);
    const promise=Promise.resolve(existing).then(()=>readData(provider,{interactive:true})).finally(()=>{if(flight?.promise===promise)flight=null;});
    flight={provider,kind:'data',promise};return promise;
  }
  function disable(provider){
    try{check(provider);}catch(error){return Promise.reject(error);}
    if(flight)return Promise.reject(failure('BUSY'));
    const epoch=++revisions[provider];dataFlights.delete(provider);
    update(provider,{status:'working',step:'revoking',message:'正在停止联动…'},epoch);
    const promise=Promise.resolve().then(()=>revoke(provider)).then(()=>{
      if(!valid(provider,epoch))return;states[provider]={...initial(),message:'已停止联动并撤销本地数据授权。',chat:{status:'unavailable',message:'聊天已断开'}};onChange();
    }).catch(error=>{update(provider,{status:'error',step:null,message:'停止联动未完成，请重试。'},epoch);throw error;}).finally(()=>{if(flight?.promise===promise)flight=null;});
    flight={provider,kind:'revoke',promise};return promise;
  }
  async function restore(provider){if(flight)await flight.promise;if(!closed)return enable(provider,{interactive:false});}
  function close(){closed=true;for(const provider of PROVIDERS)revisions[provider]++;}
  return{getState,enable,enableData,restore,disable,close};
}
module.exports={createMasEnableFlow};
