'use strict';
const {randomUUID}=require('node:crypto');
const {createWorkBuddyLiveTask}=require('./workbuddy-live-task');
const MESSAGES={AUTHORIZATION_REQUIRED:'请点击启用授权，完成官方登录。',TOOL_BLOCKED:'检测到工具或审批请求，本次聊天已停止；未自动批准。',
  UNKNOWN_OUTCOME:'请求结果未知，请先核对本次会话，暂不重发。',UNSAFE_CONFIG:'聊天组件未维持只聊天模式，连接已停止，请重新启用授权。',UNAUTHENTICATED:'连接已失效，请重新启用授权。',UNSAFE_MODE:'聊天组件未处于只聊天模式，未发送消息。',
  INVALID_INPUT:'消息或连接配置无效。',CONNECTION_FAILED:'暂时无法连接，请稍后重试启用授权。',TIMEOUT:'回复超时，请先核对本次会话，暂不自动重发。'};
const fail=code=>Object.assign(new Error(code),{code});
function createWorkBuddyCliConnection({createClient,onChange=()=>{},store,conversationStore,now=Date.now,onTaskChange=()=>{}}={}){
  let client=null,closed=false,epoch=0,sessionId=null,resumeId=null,accountKey=null,workspaceDir=null,activeRequestId=null,pendingRecord=null;
  let state={configured:false,gatewayReachable:false,connected:false,busy:false,error:null,tasks:[],sessions:[],messages:[],sendOutcome:null,
    scope:'dedicated-codebuddy-cli-workspace',desktopTasksIncluded:false,modelSource:'cli-default',currentModelId:null};
  try{if((pendingRecord=store?.read())?.pendingSend)state={...state,sendOutcome:'unknown',error:MESSAGES.UNKNOWN_OUTCOME};}catch(_){pendingRecord={pendingSend:true};state.sendOutcome='unknown';state.error=MESSAGES.UNKNOWN_OUTCOME;}
  const getState=()=>structuredClone({...state,liveTask:liveTask.getState()}),emit=()=>{if(!closed)onChange(getState());},update=p=>{state={...state,...p};emit();};
  const valid=e=>!closed&&e===epoch;
  const liveTask=createWorkBuddyLiveTask({now,onChange:task=>{try{onTaskChange(task);}catch(_){}emit();}});
  liveTask.restorePending(pendingRecord);
  function persist(messages=state.messages){
    if(!conversationStore||!accountKey||!sessionId)return;
    const record={version:1,accountKey,workspaceDir,sessionId,messages:messages.slice(-32)};
    while(Buffer.byteLength(JSON.stringify(record),'utf8')>480*1024&&record.messages.length>2)record.messages.splice(0,2);
    conversationStore.write(record);
  }
  function savedConversation(pairing){if(!conversationStore||!pairing.accountKey)return null;const saved=conversationStore.read(pairing.accountKey);if(saved?.version!==1||saved.accountKey!==pairing.accountKey||saved.workspaceDir!==pairing.workspaceDir||typeof saved.sessionId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(saved.sessionId)||!Array.isArray(saved.messages)||saved.messages.length>32||saved.messages.some(m=>!['user','assistant'].includes(m.role)||typeof m.text!=='string'||m.text.length>16000||!['complete','cancelled','refusal','streaming','unknown'].includes(m.status)))return null;return saved;}
  async function operation(work){if(closed)throw fail('CLOSED');if(!client)throw fail('AUTHORIZATION_REQUIRED');if(state.busy)throw fail('BUSY');const e=epoch;update({busy:true,error:null});try{return await work(e);}catch(err){if(valid(e))update({error:MESSAGES[err?.code]||'本次 CLI 操作未完成，请检查连接。'});return getState();}finally{if(valid(e))update({busy:false});}}
  async function configure(pairing){if(state.busy)throw fail('BUSY');if(closed)throw fail('CLOSED');
    const restored=savedConversation(pairing);
    const nextEpoch=epoch+1;const next=createClient({baseUrl:pairing.endpoint,gatewayPassword:pairing.password,workspaceDir:pairing.workspaceDir,restorableSessionIds:restored?[restored.sessionId]:[],
      onEvent:event=>{if(valid(nextEpoch)&&event.type==='delta'&&typeof event.text==='string'&&sessionId===event.sessionId){liveTask.progress(activeRequestId);const messages=state.messages.map(m=>m.role==='assistant'&&m.status==='streaming'?{...m,text:(m.text+event.text).slice(0,16000)}:m);update({messages});}}});
    const previous=client;client=next;epoch++;sessionId=null;resumeId=restored?.sessionId||null;accountKey=pairing.accountKey||null;workspaceDir=pairing.workspaceDir;await previous?.close();if(!valid(nextEpoch))return getState();if(state.sendOutcome!=='unknown')liveTask.clear();activeRequestId=null;
    update({configured:true,gatewayReachable:false,connected:false,tasks:[],sessions:[],messages:restored?restored.messages.map(m=>m.status==='streaming'?{...m,status:'unknown'}:m):[],endpoint:pairing.endpoint,cliVersion:pairing.cliVersion,error:null});return getState();}
  function refresh(){return operation(async e=>{await client.getHealth();if(!valid(e))return;update({gatewayReachable:true});
    const sessions=await client.listSessions();if(!valid(e))return;
    const tasks=await client.listTasks();if(!valid(e))return;
    update({sessions:Array.isArray(sessions.sessions)?sessions.sessions:[],tasks:Array.isArray(tasks.tasks)?tasks.tasks:[],tasksPartial:tasks.partial!==false});return getState();});}
  function connect(){return operation(async e=>{if(state.connected&&sessionId)return getState();await client.connect();if(!valid(e))return;const session=resumeId?await client.loadSession({sessionId:resumeId}):await client.createSession();if(!valid(e))return;sessionId=session.sessionId;resumeId=sessionId;persist();update({connected:true,gatewayReachable:true,currentModelId:session.currentModelId||null});return getState();});}
  function send(content){return operation(async e=>{if(state.sendOutcome==='unknown')throw fail('UNKNOWN_OUTCOME');if(!state.connected||!sessionId)throw fail('AUTHORIZATION_REQUIRED');if(typeof content!=='string'||!content.trim()||content.length>8000)throw fail('INVALID_INPUT');
    const requestId=randomUUID();store?.write({pendingSend:true,requestId,createdAt:now()});
    update({sendOutcome:'sending',messages:[...state.messages,{role:'user',text:content.trim(),status:'complete'},{role:'assistant',text:'',status:'streaming'}]});
    let dispatched=false;
    try{persist();activeRequestId=requestId;liveTask.start(requestId,content.trim());dispatched=true;const result=await client.sendMessage({sessionId,content:content.trim()});if(!valid(e))return;
      if(!['complete','cancelled','refusal'].includes(result.completion))throw fail('UNKNOWN_OUTCOME');
      const completed=state.messages.map(m=>m.role==='assistant'&&m.status==='streaming'?{...m,text:typeof result.text==='string'?result.text.slice(0,16000):m.text,status:result.completion}:m);persist(completed);
      store?.write({pendingSend:false,requestId,createdAt:now(),completion:result.completion});
      update({sendOutcome:result.completion,messages:completed});liveTask.finish(requestId,result.completion);activeRequestId=null;return getState();
    }catch(err){if(valid(e)&&dispatched){if(['RPC_ERROR','RATE_LIMITED','UNSAFE_MODE'].includes(err?.code))liveTask.fail(requestId,err.code);else liveTask.unknown(requestId,['TIMEOUT','UNKNOWN_OUTCOME','DISCONNECTED','TOOL_BLOCKED','UNSAFE_CONFIG','CLOSED'].includes(err?.code)?err.code:'UNKNOWN_OUTCOME');activeRequestId=null;}if(valid(e))update({sendOutcome:'unknown',...(['TOOL_BLOCKED','UNSAFE_CONFIG','CLOSED','DISCONNECTED','UNKNOWN_OUTCOME'].includes(err?.code)?{connected:false}:{}),messages:state.messages.map(m=>m.status==='streaming'?{...m,status:'unknown'}:m)});throw err;}
  });}
  async function cancel(){if(sessionId&&client){const requestId=activeRequestId;liveTask.cancelling(requestId);try{await client.cancel({sessionId});}catch(error){liveTask.unknown(requestId,'CANCEL_UNCONFIRMED');throw error;}}return getState();}
  function confirmUnknownReviewed(){if(state.busy)throw fail('BUSY');store?.write({pendingSend:false,reviewedInOriginalClient:true,createdAt:now()});update({sendOutcome:null,error:null});}
  async function disconnect(){liveTask.disconnect();activeRequestId=null;epoch++;sessionId=null;const previous=client;client=null;update({configured:false,connected:false,gatewayReachable:false,busy:false,sendOutcome:state.sendOutcome==='sending'?'unknown':state.sendOutcome,tasks:[],sessions:[],messages:[],endpoint:null});await previous?.close();return getState();}
  async function close(){liveTask.disconnect();activeRequestId=null;closed=true;epoch++;sessionId=null;state={...state,connected:false,busy:false,sendOutcome:state.sendOutcome==='sending'?'unknown':state.sendOutcome};await client?.close();}
  async function getConsentIdentity(){
    if(closed||!client||!state.connected||state.busy)throw fail('AUTHORIZATION_REQUIRED');
    const currentClient=client,currentEpoch=epoch,currentSession=sessionId;
    const observed=typeof client.getVendorAccount==='function'?await client.getVendorAccount():null;
    if(!valid(currentEpoch)||client!==currentClient||sessionId!==currentSession||observed&&(!observed.authenticated||accountKey&&accountKey!==observed.accountKey))throw fail('UNAUTHENTICATED');
    return{accountKey:observed?.accountKey||null,conversationKey:currentSession,revision:currentEpoch};
  }
  return{configure,refresh,connect,send,getConsentIdentity,cancel,confirmUnknownReviewed,getState,disconnect,close};
}
module.exports={createWorkBuddyCliConnection};
