'use strict';
// Only the current, explicitly sent Qiuqiu ACP response. REST job/session rows
// and the original WorkBuddy Desktop cache never enter this lifecycle.
function createWorkBuddyLiveTask({now=Date.now,onChange=()=>{}}={}){
  let task=null;
  const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(id);
  const getState=()=>task?structuredClone(task):null;
  const clock=()=>{const value=Number(now());return Math.max(task?.updatedAt||0,Number.isFinite(value)&&value>=0?Math.trunc(value):Date.now());};
  function publish(patch){
    const next={...task,...patch,updatedAt:clock()};
    if(task&&Object.keys(patch).every(key=>task[key]===patch[key]))return getState();
    task=next;try{onChange(getState());}catch(_){}return getState();
  }
  function owns(id){return Boolean(task&&task.id===id);}
  function start(id,title){
    if(!validId(id)||typeof title!=='string')throw new TypeError('A dedicated request id and title are required');
    const time=clock();task={id,title:title.trim().slice(0,160)||'球球专用回复',source:'workbuddy-cli',scope:'qiuqiu-dedicated-cli-response',originalDesktopTask:false,
      state:'active',phase:'starting',running:true,realtime:true,evidence:'own-prompt-dispatched',startedAt:time,updatedAt:time,finishedAt:null,errorCode:null};
    try{onChange(getState());}catch(_){}return getState();
  }
  function progress(id){if(!owns(id)||task.state!=='active'||task.phase!=='starting')return getState();return publish({phase:'running',evidence:'own-acp-message-delta'});}
  function cancelling(id){if(!owns(id)||task.state!=='active')return getState();return publish({phase:'cancelling',evidence:'cancel-requested-final-result-pending'});}
  function finish(id,completion){
    if(!owns(id))return getState();
    const state={complete:'completed',cancelled:'interrupted',refusal:'refused'}[completion];
    if(!state)throw new TypeError('A confirmed ACP terminal result is required');
    if(task.state===state&&task.phase==='terminal')return getState();
    return publish({state,phase:'terminal',running:false,realtime:true,evidence:'own-session-prompt-final-response',finishedAt:clock(),errorCode:null});
  }
  function fail(id,code='RPC_ERROR'){
    if(!owns(id))return getState();
    return publish({state:'failed',phase:'terminal',running:false,realtime:true,evidence:'own-prompt-definite-rejection',finishedAt:clock(),errorCode:code});
  }
  function unknown(id,code='DISCONNECTED'){
    if(!owns(id)||!['active','unknown'].includes(task.state))return getState();
    return publish({state:'unknown',phase:'unknown',running:null,realtime:false,evidence:'final-result-not-observed',finishedAt:null,errorCode:code});
  }
  function restorePending(record){
    if(!record?.pendingSend)return;
    const time=Number.isFinite(record.createdAt)&&record.createdAt>=0?Math.trunc(record.createdAt):clock();
    task={id:validId(record.requestId)?record.requestId:'restored-unknown',title:'上次球球专用回复',source:'workbuddy-cli',scope:'qiuqiu-dedicated-cli-response',originalDesktopTask:false,
      state:'unknown',phase:'unknown',running:null,realtime:false,evidence:'restored-pending-intent',startedAt:time,updatedAt:clock(),finishedAt:null,errorCode:'UNKNOWN_OUTCOME'};
  }
  return{getState,clear:()=>{task=null;},start,progress,cancelling,finish,fail,unknown,restorePending,disconnect:()=>task?unknown(task.id):null};
}
module.exports={createWorkBuddyLiveTask};
