'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const fail=code=>Object.assign(new Error(code),{code});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(value);
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const instructions='你是桌面宠物球球，用简短自然的中文陪用户聊天。只聊天，不执行工具、不读取文件或其他会话。只输出JSON对象，包含text和action字段，action固定为none。';
function readBounded(file,max=4*1024*1024){let fd;try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw fail('DIRECT_CONFIG_INCOMPLETE');fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const current=fs.fstatSync(fd);if(current.dev!==stat.dev||current.ino!==stat.ino||current.size>max)throw fail('DIRECT_CONFIG_INCOMPLETE');return JSON.parse(fs.readFileSync(fd,'utf8'));}catch(e){throw fail(e.code==='ENOENT'?'DIRECT_CONFIG_INCOMPLETE':e.code==='THREAD_BUSY'?e.code:'DIRECT_CONFIG_INCOMPLETE');}finally{if(fd!==undefined)fs.closeSync(fd);}}
function strictProjection(document){
 if(document?.schemaVersion!==1||!plain(document.config))throw fail('DIRECT_CONFIG_INCOMPLETE');
 const providers=document.config.providerConfigRules?.providerRules,models=document.config.modelConfigRules;
 if(!Array.isArray(providers)||providers.length>256||!plain(models)||!Array.isArray(models.providerModelRules)||!Array.isArray(models.manualProviderModelRules))throw fail('DIRECT_CONFIG_INCOMPLETE');
 const catalog=[],routes=new Map();let codingOnly=false;
 for(const row of providers){
  if(!plain(row)||typeof row.providerId!=='string'||row.providerId.startsWith('account:')||row.enabled===false)continue;
  const c=row.config;
  // A template identifier does not license guessing missing built-in values.
  if(!plain(c)||c.access?.type!=='api-key'||c.api?.type!=='openai-chat-completions'||typeof c.access.apiKey!=='string'||!c.access.apiKey||c.access.apiKey.length>16384||/[\x00-\x20\x7f]/.test(c.access.apiKey))continue;
  let base;try{base=new URL(c.api.baseUrl);}catch{continue;}
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.port&&base.port!=='443')continue;
  if((['api.kimi.com','api.kimi.ai'].includes(base.hostname)&&/^\/coding(?:\/|$)/.test(base.pathname))||(['api.z.ai','open.bigmodel.cn'].includes(base.hostname)&&/^\/api\/coding(?:\/|$)/.test(base.pathname))){codingOnly=true;continue;}
  // Use the selected provider's declared base, never infer a vendor or change account source.
  const endpoint=base.href.replace(/\/+$/,'')+'/chat/completions';
  const headers={'content-type':'application/json',authorization:'Bearer '+c.access.apiKey};
  let validHeaders=true;
  if(c.api.headers!=null){if(!plain(c.api.headers)||Object.keys(c.api.headers).length>32)continue;for(const[k,v]of Object.entries(c.api.headers)){if(!/^[A-Za-z0-9-]{1,128}$/.test(k)||typeof v!=='string'||v.length>8192||/[\x00-\x1f\x7f]/.test(v)||/^(host|content-length|connection|cookie|authorization|proxy-authorization)$/i.test(k)){validHeaders=false;break;}headers[k]=v;}}
  if(!validHeaders)continue;
  const modelIds=[...new Set([...(Array.isArray(c.builtinModelIds)?c.builtinModelIds:[]),...(Array.isArray(c.personalModelIds)?c.personalModelIds:[])])];
  for(const modelId of modelIds.slice(0,200)){
   if(typeof modelId!=='string'||!modelId||modelId.length>160||/[\x00-\x20\x7f]/.test(modelId))continue;
   const rules=[...models.providerModelRules,...models.manualProviderModelRules].filter(r=>r?.providerId===row.providerId&&r.modelId===modelId);
   if(rules.some(r=>r.config?.enabled===false))continue;
   const modelKey='zcode-direct-'+hash([row.providerId,modelId]).slice(0,32);
   catalog.push({id:modelKey,displayName:`${String(row.providerName||row.providerId).slice(0,100)} · ${modelId}`,supportedReasoningEfforts:['none'],defaultReasoningEffort:'none',isDefault:false});
   routes.set(modelKey,{endpoint,headers,modelId});
  }
 }
 if(!catalog.length)throw fail(codingOnly?'CODING_PLAN_SCOPE_UNSUPPORTED':'DIRECT_CONFIG_INCOMPLETE');
 return{catalog,routes,accountKey:hash(['zcode-configured-custom-direct',document])};
}
function createZcodeDirectChatRpc({directoryAccess,workspaceDir,accountSource,fetch:request=globalThis.fetch,onNotification=()=>{},onDisconnect=()=>{},timeoutMs=30000}={}){
 if(accountSource!=='configured-custom')throw fail('EXPLICIT_CUSTOM_SOURCE_REQUIRED');
 if(!directoryAccess?.withAccess||!path.isAbsolute(workspaceDir||'')||typeof request!=='function')throw fail('INVALID_INPUT');
 let closed=false,projection=null,thread=null,active=null;
 const emit=(method,params)=>{if(!closed)onNotification({method,params});};
 async function current(){if(closed)throw fail('CLOSED');let next;try{next=await directoryAccess.withAccess('zcode',async directory=>{
  const nested=path.join(directory,'v2');const stat=fs.lstatSync(nested);if(!stat.isDirectory()||stat.isSymbolicLink())throw fail('DIRECT_CONFIG_INCOMPLETE');
  return strictProjection(readBounded(path.join(nested,'provider_config.json')));
 });}catch(e){throw fail(e.code==='DIRECTORY_ACCESS_REQUIRED'?'DIRECTORY_ACCESS_REQUIRED':'DIRECT_CONFIG_INCOMPLETE');}if(projection&&next.accountKey!==projection.accountKey){projection=null;emit('account/updated',{});throw fail('UNAUTHENTICATED');}projection=next;return next;}
 function root(){fs.mkdirSync(workspaceDir,{recursive:true,mode:0o700});if(fs.lstatSync(workspaceDir).isSymbolicLink())throw fail('UNSAFE_CONFIG');return workspaceDir;}
 function file(threadId){if(!id(threadId))throw fail('THREAD_NOT_FOUND');return path.join(root(),threadId+'.json');}
 function save(value){const destination=file(value.id),temporary=destination+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});fs.renameSync(temporary,destination);}finally{try{fs.unlinkSync(temporary);}catch{}}}
 function load(threadId){let value;try{value=readBounded(file(threadId),2*1024*1024);}catch{throw fail('THREAD_NOT_FOUND');}if(value?.version!==1||value.id!==threadId||value.accountKey!==projection.accountKey||!Array.isArray(value.messages)||value.messages.length>128||value.messages.some(m=>!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>128*1024))throw fail('THREAD_NOT_FOUND');return value;}
 async function boundedResponse(response){if(Number(response.headers?.get?.('content-length'))>1024*1024)throw fail('INVALID_FRAME');if(!response.body?.getReader){throw fail('INVALID_FRAME');}const reader=response.body.getReader();let size=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024)throw fail('INVALID_FRAME');chunks.push(Buffer.from(value));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}finally{try{await reader.cancel();}catch{}}}
 async function run(turn,route,text){
  let timer=setTimeout(()=>turn.controller.abort(),Math.max(1,Math.min(timeoutMs,120000)));timer.unref?.();
  try{
   const response=await request(route.endpoint,{method:'POST',redirect:'error',signal:turn.controller.signal,headers:route.headers,body:JSON.stringify({model:route.modelId,messages:[{role:'system',content:instructions},...thread.messages,{role:'user',content:text}],stream:false,tool_choice:'none'})});
   if(closed||active!==turn)return;
   if(!response.ok){await response.body?.cancel?.().catch(()=>{});throw fail(response.status===401||response.status===403?'UNAUTHENTICATED':response.status===429?'RATE_LIMITED':'DISCONNECTED');}
   const value=await boundedResponse(response),choice=value?.choices?.[0],message=choice?.message;
   if(message?.tool_calls?.length||message?.function_call||choice?.finish_reason==='tool_calls')throw fail('TOOL_BLOCKED');
   if(typeof message?.content!=='string'||!message.content||message.content.length>128*1024||choice.finish_reason!=='stop')throw fail('INVALID_FRAME');
   if(closed||active!==turn||turn.controller.signal.aborted)return;
   // Revalidate the selected config before publishing the result as this account.
   await current();if(closed||active!==turn)return;
   thread.messages.push({role:'user',content:text},{role:'assistant',content:message.content});thread.pending=false;save(thread);
   active=null;emit('item/completed',{threadId:thread.id,turnId:turn.id,item:{id:turn.id,type:'agentMessage',text:message.content,phase:'final_answer'}});emit('turn/completed',{threadId:thread.id,turn:{id:turn.id,status:'completed'}});
  }catch(e){if(!closed&&active===turn){active=null;emit('turn/completed',{threadId:thread.id,turn:{id:turn.id,status:turn.controller.signal.aborted?'interrupted':'failed',errorCode:e.code||'DISCONNECTED'}});}}
  finally{clearTimeout(timer);}
 }
 return{
  async start(){await current();},
  async readAccount(){const p=await current();return{authenticated:true,accountKey:p.accountKey};},
  async listModels(){return structuredClone((await current()).catalog);},
  async startThread(){await current();if(active)throw fail('BUSY');thread={version:1,id:'zcd-'+randomUUID(),accountKey:projection.accountKey,messages:[],pending:false};save(thread);return{id:thread.id,status:'idle'};},
  async resumeThread(threadId){await current();if(active)throw fail('BUSY');thread=load(threadId);return{id:thread.id,status:thread.pending?'active':'idle',activeTurnId:thread.pending?'unknown':null};},
  async startTurn(threadId,text,selection){await current();if(active)throw fail('BUSY');if(typeof text!=='string'||!text.trim()||text.length>2000||text.includes('\0'))throw fail('INVALID_INPUT');thread=load(threadId);if(thread.pending)throw fail('THREAD_BUSY');if(thread.messages.length>=126)throw fail('CONTEXT_LIMIT');const route=projection.routes.get(selection?.model);if(!route||selection?.effort&&selection.effort!=='none')throw fail('MODEL_UNAVAILABLE');thread.pending=true;save(thread);const turn={id:'zcd-turn-'+randomUUID(),controller:new AbortController()};active=turn;emit('turn/started',{threadId,turn:{id:turn.id,status:'inProgress'}});void run(turn,route,text.trim());return{id:turn.id,status:'inProgress'};},
  async interruptTurn(threadId,turnId){if(active&&thread?.id===threadId&&active.id===turnId)active.controller.abort();return{};},
  async nameThread(){throw fail('UNSUPPORTED');},
  async close(){if(closed)return;closed=true;active?.controller.abort();active=null;projection=null;thread=null;}
 };
}
module.exports={createZcodeDirectChatRpc,strictProjection};
