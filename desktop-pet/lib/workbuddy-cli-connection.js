'use strict';
const {randomUUID}=require('node:crypto');
const MESSAGES={AUTHORIZATION_REQUIRED:'请先在独立官方 CLI 中完成账号登录。',TOOL_BLOCKED:'检测到工具或审批请求，本次聊天已停止；未自动批准。',
  UNKNOWN_OUTCOME:'请求结果未知，请先核对本次 CLI 会话，暂不重发。',UNSAFE_CONFIG:'本机 CLI 未维持工具禁用模式，已停止连接；请重新导入。',UNAUTHENTICATED:'本机服务口令失效，请重新导入当前连接。',UNSAFE_MODE:'本机 CLI 未处于要求的工具禁用模式，未发送消息。',
  INVALID_INPUT:'消息或连接配置无效。',CONNECTION_FAILED:'本机 CLI 暂时无法连接，请检查专用服务。',TIMEOUT:'本机 CLI 响应超时，请核对会话后再操作。'};
const fail=code=>Object.assign(new Error(code),{code});
function createWorkBuddyCliConnection({createClient,onChange=()=>{},store,now=Date.now}={}){
  let client=null,closed=false,epoch=0,sessionId=null;
  let state={configured:false,gatewayReachable:false,connected:false,busy:false,error:null,tasks:[],sessions:[],messages:[],sendOutcome:null,
    scope:'dedicated-codebuddy-cli-workspace',desktopTasksIncluded:false,modelSource:'cli-default',currentModelId:null};
  try{if(store?.read()?.pendingSend)state={...state,sendOutcome:'unknown',error:MESSAGES.UNKNOWN_OUTCOME};}catch(_){state.sendOutcome='unknown';state.error=MESSAGES.UNKNOWN_OUTCOME;}
  const getState=()=>structuredClone(state),emit=()=>{if(!closed)onChange(getState());},update=p=>{state={...state,...p};emit();};
  const valid=e=>!closed&&e===epoch;
  async function operation(work){if(closed)throw fail('CLOSED');if(!client)throw fail('AUTHORIZATION_REQUIRED');if(state.busy)throw fail('BUSY');const e=epoch;update({busy:true,error:null});try{return await work(e);}catch(err){if(valid(e))update({error:MESSAGES[err?.code]||'本次 CLI 操作未完成，请检查连接。'});return getState();}finally{if(valid(e))update({busy:false});}}
  async function configure(pairing){if(state.busy)throw fail('BUSY');if(closed)throw fail('CLOSED');
    const nextEpoch=epoch+1;const next=createClient({baseUrl:pairing.endpoint,gatewayPassword:pairing.password,workspaceDir:pairing.workspaceDir,
      onEvent:event=>{if(valid(nextEpoch)&&event.type==='delta'&&typeof event.text==='string'&&sessionId===event.sessionId){const messages=state.messages.map(m=>m.role==='assistant'&&m.status==='streaming'?{...m,text:(m.text+event.text).slice(0,16000)}:m);update({messages});}}});
    const previous=client;client=next;epoch++;sessionId=null;await previous?.close();
    update({configured:true,gatewayReachable:false,connected:false,tasks:[],sessions:[],messages:[],endpoint:pairing.endpoint,cliVersion:pairing.cliVersion,error:null});return getState();}
  function refresh(){return operation(async e=>{await client.getHealth();if(!valid(e))return;update({gatewayReachable:true});
    const sessions=await client.listSessions();if(!valid(e))return;
    const tasks=await client.listTasks();if(!valid(e))return;
    update({sessions:Array.isArray(sessions.sessions)?sessions.sessions:[],tasks:Array.isArray(tasks.tasks)?tasks.tasks:[],tasksPartial:tasks.partial!==false});return getState();});}
  function connect(){return operation(async e=>{if(state.connected&&sessionId)return getState();await client.connect();if(!valid(e))return;const session=await client.createSession();if(!valid(e))return;sessionId=session.sessionId;update({connected:true,gatewayReachable:true,currentModelId:session.currentModelId||null});return getState();});}
  function send(content){return operation(async e=>{if(state.sendOutcome==='unknown')throw fail('UNKNOWN_OUTCOME');if(!state.connected||!sessionId)throw fail('AUTHORIZATION_REQUIRED');if(typeof content!=='string'||!content.trim()||content.length>8000)throw fail('INVALID_INPUT');
    const requestId=randomUUID();store?.write({pendingSend:true,requestId,createdAt:now()});
    update({sendOutcome:'sending',messages:[...state.messages,{role:'user',text:content.trim(),status:'complete'},{role:'assistant',text:'',status:'streaming'}]});
    try{const result=await client.sendMessage({sessionId,content:content.trim()});if(!valid(e))return;
      if(!['complete','cancelled','refusal'].includes(result.completion))throw fail('UNKNOWN_OUTCOME');
      store?.write({pendingSend:false,requestId,createdAt:now(),completion:result.completion});
      update({sendOutcome:result.completion,messages:state.messages.map(m=>m.role==='assistant'&&m.status==='streaming'?{...m,text:typeof result.text==='string'?result.text.slice(0,16000):m.text,status:result.completion}:m)});return getState();
    }catch(err){if(valid(e))update({sendOutcome:'unknown',...(['TOOL_BLOCKED','UNSAFE_CONFIG','CLOSED','DISCONNECTED','UNKNOWN_OUTCOME'].includes(err?.code)?{connected:false}:{}),messages:state.messages.map(m=>m.status==='streaming'?{...m,status:'unknown'}:m)});throw err;}
  });}
  async function cancel(){if(sessionId&&client)await client.cancel({sessionId});return getState();}
  function confirmUnknownReviewed(){if(state.busy)throw fail('BUSY');store?.write({pendingSend:false,reviewedInOriginalClient:true,createdAt:now()});update({sendOutcome:null,error:null});}
  async function close(){closed=true;epoch++;sessionId=null;state={...state,connected:false,busy:false,sendOutcome:state.sendOutcome==='sending'?'unknown':state.sendOutcome};await client?.close();}
  return{configure,refresh,connect,send,cancel,confirmUnknownReviewed,getState,close};
}
module.exports={createWorkBuddyCliConnection};
