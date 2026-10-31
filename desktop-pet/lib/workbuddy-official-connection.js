'use strict';
const { randomUUID } = require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const { createWorkBuddyRelayClient } = require('./workbuddy-relay-client');
const MESSAGES = { AUTHORIZATION_REQUIRED:'请先完成 WorkBuddy 开放平台授权。', PERMISSION_REQUIRED:'应用尚未获得所需权限。',
  ASSISTANT_OFFLINE:'WorkBuddy 本机助理离线，请在原客户端连接。', UNKNOWN_OUTCOME:'发送结果尚未确认，已停止重发。请到原 WorkBuddy 核对。',
  RATE_LIMITED:'查询过于频繁，请稍后重试。', TIMEOUT:'连接超时，请稍后刷新。', CONNECTION_FAILED:'暂时无法连接任务聊天服务。',
  INVALID_REQUEST:'服务地址或请求无效，请检查配置。', SERVICE_UNAVAILABLE:'服务端尚未就绪，请检查应用配置。' };
const failure = code => Object.assign(new Error(code),{code});
function createWorkBuddyOfficialConnection({ createClient=createWorkBuddyRelayClient, openAuthorizationUrl,
  onChange=()=>{}, store, now=Date.now, diagnostic=false }={}) {
  let client=null, generation=0, closed=false, flight=null;
  let state={configured:false,baseUrl:null,connected:false,pending:false,scopes:[],assistantOnline:null,tasks:[],
    tasksPartial:true,messages:[],anchorMessageId:null,busy:false,status:'not-configured',error:null,sendOutcome:null};
  if(store)try{const record=store.read();if(record?.pendingSend===true)state={...state,sendOutcome:'unknown',error:MESSAGES.UNKNOWN_OUTCOME};}catch(_){state.error='上次发送记录无法核对，请先检查原 WorkBuddy。';state.sendOutcome='unknown';}
  const getState=()=>structuredClone({...state,scope:'cloud-tasks-and-shared-local-assistant',localAssistantConversationIsolated:false});
  const emit=()=>{if(!closed)onChange(getState());};
  const update=patch=>{state={...state,...patch};emit();};
  function valid(epoch){return !closed&&epoch===generation;}
  function record(value){if(store)store.write(value);}
  async function operation(work){
    if(closed)throw failure('CLOSED');if(!client)throw failure('AUTHORIZATION_REQUIRED');if(flight)throw failure('BUSY');
    const epoch=generation;update({busy:true,error:state.sendOutcome==='unknown'?MESSAGES.UNKNOWN_OUTCOME:null});
    const action=Promise.resolve().then(()=>work(epoch)).catch(e=>{if(valid(epoch))update({error:MESSAGES[e?.code]||'本次操作未完成，请检查连接。',...(e?.code==='AUTHORIZATION_REQUIRED'?{connected:false,status:'authorization-required',assistantOnline:null,tasks:[],messages:[],anchorMessageId:null}:{})});return getState();})
      .finally(()=>{if(flight===action)flight=null;if(valid(epoch))update({busy:false});});flight=action;return action;
  }
  function configure(baseUrl){
    if(closed)throw failure('CLOSED');if(state.busy)throw failure('BUSY');
    const next=createClient({baseUrl,diagnostic});client?.close();client=next;generation++;
    state={...state,configured:true,baseUrl,connected:false,pending:false,scopes:[],assistantOnline:null,tasks:[],messages:[],anchorMessageId:null,
      status:'configured',tasksPartial:true,error:state.sendOutcome==='unknown'?MESSAGES.UNKNOWN_OUTCOME:null};emit();return getState();
  }
  async function refreshTasks(epoch){
    const tasks=[];const seen=new Set();let total=null,partial=true,changed=false;
    for(let page=1;page<=5;page++){
      const result=await client.listTasks({page,size:100});if(!valid(epoch))return;
      if(!Array.isArray(result.tasks)||result.pagination?.page!==page||!Number.isSafeInteger(result.pagination?.total)||result.pagination.total<0)throw failure('INVALID_RESPONSE');
      if(total!==null&&total!==result.pagination.total)changed=true;total=result.pagination.total;
      for(const row of result.tasks)if(row&&typeof row.id==='string'&&typeof row.status==='string'&&!seen.has(row.id)){seen.add(row.id);tasks.push({id:row.id,name:typeof row.name==='string'?row.name.slice(0,160):'未命名任务',status:row.status,updatedAt:row.updatedAt??null});}
      if(tasks.length>=total){partial=changed;break;}if(result.tasks.length===0)break;
    }
    if(valid(epoch))update({tasks,tasksPartial:partial,taskObservedAt:now()});
  }
  function refresh(){return operation(async epoch=>{
    const status=await client.getConnectionState();if(!valid(epoch))return getState();
    update({connected:status.connected===true,pending:status.pending===true,scopes:status.scopes||[],status:status.connected?'connected':status.pending?'awaiting-authorization':'authorization-required'});
    if(!status.connected){update({assistantOnline:null,tasks:[],tasksPartial:true});return getState();}
    const assistant=await client.getAssistantStatus();if(!valid(epoch))return getState();update({assistantOnline:assistant.online===true});
    await refreshTasks(epoch);return getState();
  });}
  function beginAuthorization(){return operation(async epoch=>{
    const auth=await client.beginAuthorization();if(!valid(epoch))return getState();
    update({connected:false,pending:true,status:'awaiting-authorization',tasks:[],messages:[],anchorMessageId:null});
    await openAuthorizationUrl(auth.authorizationUrl);return getState();
  });}
  function refreshMessages(){return operation(async epoch=>{
    if(!state.connected||!state.anchorMessageId)throw failure('AUTHORIZATION_REQUIRED');
    const result=await client.listMessages({afterMessageId:state.anchorMessageId,offset:0,limit:100});if(!valid(epoch))return getState();
    const rows=Array.isArray(result.messages)?result.messages:[];
    const messages=rows.filter(r=>r&&typeof r.id==='string').map(r=>({id:r.id,role:r.role==='assistant'?'assistant':'other',
      text:Array.isArray(r.content)?r.content.filter(c=>c?.type==='text'&&typeof c.text==='string').map(c=>c.text).join('\n').slice(0,16000):'',
      requiresOriginalClient:r.msgType==='permission_request'||r.unsupportedContentCount>0||r.metadataPresent===true}));
    update({messages,historyPartial:true,replyCompletion:'not-confirmed'});return getState();
  });}
  function send(content){return operation(async epoch=>{
    if(state.sendOutcome==='unknown')throw failure('UNKNOWN_OUTCOME');
    if(!state.connected)throw failure('AUTHORIZATION_REQUIRED');
    if(typeof content!=='string'||!content.trim()||content.length>8000)throw failure('INVALID_REQUEST');
    const requestId=randomUUID();
    record({pendingSend:true,requestId,createdAt:now()});
    update({sendOutcome:'sending'});
    try{
      const result=await client.sendMessage({content:content.trim(),requestId});if(!valid(epoch))return getState();
      if(result.state!=='accepted'||typeof result.messageId!=='string')throw failure('UNKNOWN_OUTCOME');
      record({pendingSend:false,requestId,messageId:result.messageId,createdAt:now()});
      update({sendOutcome:'accepted',anchorMessageId:result.messageId,messages:[],replyCompletion:'not-confirmed'});return getState();
    }catch(e){
      if(valid(epoch)){
        if(['ASSISTANT_OFFLINE','AUTHORIZATION_REQUIRED','PERMISSION_REQUIRED','RATE_LIMITED','INVALID_REQUEST'].includes(e.code)){
          try{record({pendingSend:false,requestId,outcome:'rejected',createdAt:now()});}catch(_){update({sendOutcome:'unknown'});throw failure('UNKNOWN_OUTCOME');}
          update({sendOutcome:'rejected'});throw e;
        }
        update({sendOutcome:'unknown'});
      }
      throw failure('UNKNOWN_OUTCOME');
    }
  });}
  async function disconnect(){if(state.busy)throw failure('BUSY');generation++;await client?.disconnect();update({connected:false,pending:false,assistantOnline:null,tasks:[],messages:[],anchorMessageId:null,status:'disconnected'});}
  function confirmUnknownReviewed(){if(state.busy)throw failure('BUSY');record({pendingSend:false,reviewedInOriginalClient:true,createdAt:now()});update({sendOutcome:null,error:null});}
  function close(){closed=true;generation++;client?.close();}
  return{configure,beginAuthorization,refresh,refreshMessages,send,disconnect,confirmUnknownReviewed,getState,close};
}
function createWorkBuddyIntentStore(file,{maxBytes=16384}={}){
  if(typeof file!=='string'||!path.isAbsolute(file))throw failure('INVALID_REQUEST');
  return{
    read(){let fd;try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>maxBytes)throw failure('STORAGE');return JSON.parse(fs.readFileSync(fd,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw failure('STORAGE');}finally{if(fd!==undefined)fs.closeSync(fd);}},
    write(value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temporary=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});fs.renameSync(temporary,file);}finally{try{fs.unlinkSync(temporary);}catch(_){}}}
  };
}
module.exports={createWorkBuddyOfficialConnection,createWorkBuddyIntentStore};
