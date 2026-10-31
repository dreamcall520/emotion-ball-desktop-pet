'use strict';
const path = require('node:path');
const { TextDecoder } = require('node:util');
const SOURCE = 'workbuddy-local-cli';
const MAX_JSON_BYTES = 1024 * 1024, MAX_FRAME_BYTES = 256 * 1024, MAX_STREAM_BYTES = 8 * 1024 * 1024;
const JOB_STATES = new Set(['working', 'blocked', 'done', 'failed', 'stopped']);
const CODES = new Set(['INVALID_INPUT','INVALID_RESPONSE','FRAME_TOO_LARGE','RESPONSE_TOO_LARGE','UNAUTHENTICATED',
  'UNSUPPORTED_API','UNSUPPORTED_SCHEMA','UNSAFE_CONFIG','UNSAFE_SCOPE','NOT_CONNECTED','CLOSED','DISCONNECTED',
  'CONNECTION_FAILED','TIMEOUT','CANCELLED','BUSY','TOOL_BLOCKED','UNKNOWN_OUTCOME','RPC_ERROR','RATE_LIMITED']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
function fail(code) {
  const safe = CODES.has(code) ? code : 'CONNECTION_FAILED';
  return Object.assign(new Error(safe), { code:safe, ...(safe === 'UNKNOWN_OUTCOME' ? {outcome:'unknown',retryable:false} : {}) });
}
function loopbackOrigin(raw) {
  let url; try { url = new URL(raw); } catch (_) { throw fail('INVALID_INPUT'); }
  if (!['http:','https:'].includes(url.protocol) || !['127.0.0.1','[::1]'].includes(url.hostname) ||
      !url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw fail('INVALID_INPUT');
  return url.origin;
}
function rpcCode(error) {
  if ([401,403].includes(error?.code)) return 'UNAUTHENTICATED';
  if (error?.code === 429) return 'RATE_LIMITED';
  if ([-32601,-32602].includes(error?.code)) return 'UNSUPPORTED_API';
  return 'RPC_ERROR';
}

// Official CLI 2.179.0 runtime OpenAPI: REST envelopes, ACP connect credentials,
// JSON-RPC POST streams and optional GET notifications. This never launches/logs in
// the CLI, reads desktop credentials, loads another project's chat or approves tools.
function createWorkBuddyLocalCliClient({ baseUrl, gatewayPassword, workspaceDir, fetch:request=globalThis.fetch,
  requestTimeoutMs=10000, promptTimeoutMs=180000, onEvent=()=>{} }={}) {
  const origin = loopbackOrigin(baseUrl);
  if (typeof gatewayPassword !== 'string' || !/^[A-Za-z0-9._~+\/-]{16,8192}={0,2}$/.test(gatewayPassword) ||
      typeof workspaceDir !== 'string' || !path.isAbsolute(workspaceDir) || workspaceDir.includes('\0') ||
      typeof request !== 'function' || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 30000 ||
      !Number.isSafeInteger(promptTimeoutMs) || promptTimeoutMs < 1 || promptTimeoutMs > 300000) throw fail('INVALID_INPUT');
  workspaceDir = path.resolve(workspaceDir);
  const controllers = new Set(), ownedSessions = new Set();
  let credentials=null, connecting=null, ready=false, closed=false, closing=null, busy=false, observing=false, nextId=0, blocked=false, blockCode='TOOL_BLOCKED', blockFlight=null;
  const emit = event => { if (!closed) { try { onEvent(event); } catch (_) {} } };
  const safeText = (value, max=200) => typeof value === 'string'
    ? value.slice(0,max).split(gatewayPassword || '\0').join('[redacted]').split(credentials?.sessionToken || '\0').join('[redacted]') : null;
  function ensure() { if (blocked) throw fail(blockCode); if (closed) throw fail('CLOSED'); }
  function connected(initializing=false) { ensure(); if (!credentials||!ready&&!initializing) throw fail('NOT_CONNECTED'); }
  function headers(connectionId) {
    return { Authorization:'Bearer '+gatewayPassword,'X-CodeBuddy-Request':'1',
      ...(connectionId ? {'acp-connection-id':connectionId} : {}) };
  }
  async function operation(route, {method='GET',body,signal,timeoutMs=requestTimeoutMs,connectionId,uncertain=false}={}, consume) {
    ensure(); if (signal?.aborted) throw fail('CANCELLED');
    const controller=new AbortController(); controllers.add(controller);
    let reason=null, rejectAbort, response, reader, dispatched=false;
    const check=()=>{ if(blocked)throw fail(blockCode); if(controller.signal.aborted)throw fail(reason||'CANCELLED'); };
    const cancelReader=()=>{try{if(reader)void Promise.resolve(reader.cancel()).catch(()=>{});}catch(_){};};
    const aborted=new Promise((_,reject)=>{rejectAbort=reject;});
    const abortedListener=()=>{cancelReader();rejectAbort(fail(blocked?blockCode:reason||'CANCELLED'));};
    controller.signal.addEventListener('abort',abortedListener,{once:true});
    const externalAbort=()=>{reason='CANCELLED';controller.abort();}; signal?.addEventListener('abort',externalAbort,{once:true});
    const timer=setTimeout(()=>{reason='TIMEOUT';controller.abort();},timeoutMs);
    const work=(async()=>{
      try {
        check(); dispatched=true;
        response=await request(origin+route,{method,redirect:'manual',cache:'no-store',signal:controller.signal,
          headers:{...headers(connectionId),Accept:'application/json, text/event-stream',...(body===undefined?{}:{'Content-Type':'application/json'})},
          ...(body===undefined?{}:{body:JSON.stringify(body)})});
        check();
        if(response.redirected || response.status>=300&&response.status<400 || response.url&&response.url!==origin+route)throw fail('INVALID_RESPONSE');
        if([401,403].includes(response.status))throw fail('UNAUTHENTICATED');
        if(response.status===404)throw fail('UNSUPPORTED_API');
        if(response.status===429)throw fail('RATE_LIMITED');
        if(response.status<200||response.status>=300)throw fail('CONNECTION_FAILED');
        const getReader=()=>{if(!reader){reader=response.body?.getReader();if(!reader)throw fail('INVALID_RESPONSE');}return reader;};
        return await consume(response,{check,getReader});
      } finally {
        cancelReader();
        try { reader?.releaseLock(); } catch (_) {}
        if(!reader)try{void Promise.resolve(response?.body?.cancel()).catch(()=>{});}catch(_){}
      }
    })();
    try{return await Promise.race([work,aborted]);}
    catch(error){
      if(blocked||error?.code==='TOOL_BLOCKED')throw fail(blockCode);
      if(uncertain&&dispatched&&!error?.definiteRejection)throw fail('UNKNOWN_OUTCOME');
      throw fail(CODES.has(error?.code)?error.code:controller.signal.aborted?reason||'CANCELLED':'CONNECTION_FAILED');
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',externalAbort);controller.signal.removeEventListener('abort',abortedListener);controllers.delete(controller);controller.abort();}
  }
  async function jsonResponse(response,ctx) {
    const declared=response.headers?.get?.('content-length');
    if(declared&&/^\d+$/.test(declared)&&Number(declared)>MAX_JSON_BYTES)throw fail('RESPONSE_TOO_LARGE');
    const reader=ctx.getReader(),chunks=[];let size=0;
    for(;;){const {done,value}=await reader.read();ctx.check();if(done)break;if(!(value instanceof Uint8Array))throw fail('INVALID_RESPONSE');size+=value.length;if(size>MAX_JSON_BYTES)throw fail('RESPONSE_TOO_LARGE');chunks.push(value);}
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}catch(_){throw fail('INVALID_RESPONSE');}
  }
  async function rest(route,options) {
    return operation(route,options,async(r,ctx)=>{const value=await jsonResponse(r,ctx);if(!object(value))throw fail('INVALID_RESPONSE');
      if(value.error)throw fail(value.error.code==='AUTH_REQUIRED'?'UNAUTHENTICATED':'RPC_ERROR');
      if(!Object.hasOwn(value,'data'))throw fail('INVALID_RESPONSE');return value.data;});
  }
  async function frames(response,ctx,accept) {
    const type=response.headers?.get?.('content-type')||'';
    if(!/text\/event-stream|application\/(?:x-)?ndjson/i.test(type))throw fail('INVALID_RESPONSE');
    const reader=ctx.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
    let buffer='',event=[],eventBytes=0,total=0;
    const parse=async text=>{if(!text.trim())return;if(Buffer.byteLength(text)>MAX_FRAME_BYTES)throw fail('FRAME_TOO_LARGE');let value;try{value=JSON.parse(text);}catch(_){throw fail('INVALID_RESPONSE');}
      if(!object(value)||value.jsonrpc!=='2.0')throw fail('INVALID_RESPONSE');await accept(value);};
    const flush=async()=>{if(event.length){const data=event.join('\n');event=[];eventBytes=0;await parse(data);}};
    const line=async raw=>{
      const value=raw.endsWith('\r')?raw.slice(0,-1):raw;
      if(value===''){await flush();return;}
      if(value.startsWith(':')||/^(?:event|id|retry):/.test(value))return;
      if(value.startsWith('data:')){const text=value.slice(5).replace(/^ /,'');eventBytes+=Buffer.byteLength(text);if(eventBytes>MAX_FRAME_BYTES)throw fail('FRAME_TOO_LARGE');event.push(text);return;}
      if(value.trim().startsWith('{')){await flush();await parse(value);return;}
      throw fail('INVALID_RESPONSE');
    };
    for(;;){const {done,value}=await reader.read();ctx.check();if(done)break;if(!(value instanceof Uint8Array))throw fail('INVALID_RESPONSE');total+=value.length;if(total>MAX_STREAM_BYTES)throw fail('RESPONSE_TOO_LARGE');
      try{buffer+=decoder.decode(value,{stream:true});}catch(_){throw fail('INVALID_RESPONSE');}
      let at;while((at=buffer.indexOf('\n'))>=0){const one=buffer.slice(0,at);buffer=buffer.slice(at+1);await line(one);ctx.check();}
      if(Buffer.byteLength(buffer)>MAX_FRAME_BYTES)throw fail('FRAME_TOO_LARGE');
    }
    try{buffer+=decoder.decode();}catch(_){throw fail('INVALID_RESPONSE');}
    if(buffer)await line(buffer);await flush();
  }
  function assertOwned(id){connected();if(!validId(id)||!ownedSessions.has(id))throw fail('UNSAFE_SCOPE');}
  function block(sessionId,code='TOOL_BLOCKED'){
    if(blockFlight)return blockFlight;
    blockCode=code;blocked=true;emit({type:'blocked',code:blockCode,scope:'dedicated-cli-workspace'});
    // The published InterruptionRequest has interruptionId while resolveInterruption
    // requires toolCallId. Do not invent that mapping or send allow/allowAll.
    blockFlight=(async()=>{
      if(credentials&&validId(sessionId))try{await rawCancel(sessionId);}catch(_){}
      await close();
    })();
    return blockFlight;
  }
  async function notification(packet) {
    if(Object.hasOwn(packet,'method')&&Object.hasOwn(packet,'id')){
      const sessionId=packet.params?.sessionId;
      void block(validId(sessionId)&&ownedSessions.has(sessionId)?sessionId:null);
      throw fail('TOOL_BLOCKED');
    }
    if(packet.method!=='session/update')return;
    const params=packet.params,update=params?.update;
    if(!object(params)||!validId(params.sessionId)||!object(update))throw fail('INVALID_RESPONSE');
    if(!ownedSessions.has(params.sessionId))return;
    if(['tool_call','tool_call_update','interruption_request'].includes(update.sessionUpdate)||
      update.sessionUpdate==='session_info_update'&&update._meta?.['codebuddy.ai/interruptionRequest']){
      void block(params.sessionId);throw fail('TOOL_BLOCKED');
    }
    if(update.sessionUpdate==='current_mode_update'&&update.currentModeId!=='dontAsk'){
      void block(params.sessionId,'UNSAFE_CONFIG');throw fail('UNSAFE_CONFIG');
    }
    if(update.sessionUpdate==='agent_message_chunk'){
      if(update.content?.type!=='text'||typeof update.content.text!=='string'||update.content.text.length>MAX_FRAME_BYTES)throw fail('INVALID_RESPONSE');
      emit({type:'delta',sessionId:params.sessionId,text:safeText(update.content.text,MAX_FRAME_BYTES)});
      return safeText(update.content.text,MAX_FRAME_BYTES);
    }
    // Do not expose thought chunks, user history, tool arguments or raw _meta.
  }
  async function rpc(method,params,{signal,uncertain=false,timeoutMs=requestTimeoutMs,onChunk,initializing=false}={}) {
    connected(initializing);const id=++nextId;let result,received=false;
    await operation('/api/v1/acp',{method:'POST',connectionId:credentials.connectionId,
      body:{jsonrpc:'2.0',id,method,params},signal,uncertain,timeoutMs},async(r,ctx)=>{
      await frames(r,ctx,async packet=>{
        if(Object.hasOwn(packet,'method')){const text=await notification(packet);if(text!==undefined)onChunk?.(text,packet.params.sessionId);return;}
        if(packet.id!==id)return;
        if(received||Object.hasOwn(packet,'result')===Object.hasOwn(packet,'error'))throw fail('INVALID_RESPONSE');
        received=true;
        if(packet.error)throw Object.assign(fail(rpcCode(packet.error)),{definiteRejection:true});
        result=packet.result;
      });
      if(!received)throw fail('INVALID_RESPONSE');return result;
    });
    return result;
  }
  async function rawCancel(sessionId){
    const id=credentials?.connectionId,password=gatewayPassword;
    if(!id)return;
    const response=await request(origin+'/api/v1/acp',{method:'POST',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(2000),
      headers:{Authorization:'Bearer '+password,'X-CodeBuddy-Request':'1','acp-connection-id':id,'Content-Type':'application/json',Accept:'text/event-stream'},
      body:JSON.stringify({jsonrpc:'2.0',method:'session/cancel',params:{sessionId}})});
    try{await response.body?.cancel();}catch(_){}
    if(response.redirected||response.status>=300||response.status<200)throw fail('DISCONNECTED');
  }
  async function connect({signal}={}){
    ensure();if(connecting)return connecting;if(credentials&&ready)return{connected:true,protocolVersion:1};
    connecting=(async()=>{
      const value=await operation('/api/v1/acp/connect',{method:'POST',signal},jsonResponse);
      if(!object(value)||!validId(value.connectionId)||value.sessionToken!==undefined&&
        (typeof value.sessionToken!=='string'||value.sessionToken.length>8192||/[\x00-\x20\x7f]/.test(value.sessionToken)))throw fail('INVALID_RESPONSE');
      credentials={connectionId:value.connectionId,sessionToken:value.sessionToken||null};
      const result=await rpc('initialize',{protocolVersion:1,clientInfo:{name:'qiuqiu-local-cli',version:'1.0.0'},
        clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}},{signal,initializing:true});
      if(!object(result)||![1,'1'].includes(result.protocolVersion)||result.connectionId!==undefined&&result.connectionId!==credentials.connectionId)throw fail('INVALID_RESPONSE');
      ready=true;return{connected:true,protocolVersion:1};
    })().catch(async error=>{await close();throw error;});
    try{return await connecting;}finally{connecting=null;}
  }
  async function createSession({signal}={}){
    connected();if(busy||observing)throw fail('BUSY');
    // 2.179.0 runtime validation requires standard ACP `cwd`; the generated
    // OpenAPI prose currently says workingDirectory. No retry/fallback is used.
    const result=await rpc('session/new',{cwd:workspaceDir,mcpServers:[]},{signal,uncertain:true});
    if(!object(result)||!validId(result.sessionId))throw fail('INVALID_RESPONSE');
    if(result.modes?.currentModeId!=='dontAsk'){await close();throw fail('UNSAFE_CONFIG');}
    ownedSessions.add(result.sessionId);
    return{sessionId:result.sessionId,modelSource:'cli-default',currentModelId:validId(result.models?.currentModelId)?result.models.currentModelId:null};
  }
  async function sendMessage({sessionId,content,signal}={}){
    assertOwned(sessionId);if(busy||observing)throw fail('BUSY');
    if(typeof content!=='string'||!content.trim()||content.length>8000||content.includes('\0'))throw fail('INVALID_INPUT');
    busy=true;let text='';
    try{
      const result=await rpc('session/prompt',{sessionId,prompt:[{type:'text',text:content}]},{signal,uncertain:true,timeoutMs:promptTimeoutMs,
        onChunk:(chunk,id)=>{if(id===sessionId){text+=chunk;if(text.length>MAX_JSON_BYTES)throw fail('RESPONSE_TOO_LARGE');}}});
      if(!object(result)||!['end_turn','cancelled','refusal'].includes(result.stopReason))throw fail('UNKNOWN_OUTCOME');
      return{sessionId,text,stopReason:result.stopReason,completion:result.stopReason==='end_turn'?'complete':result.stopReason};
    }catch(error){if(error?.code==='UNKNOWN_OUTCOME')await close();throw error;}finally{busy=false;}
  }
  async function subscribeNotifications({signal}={}){
    connected();if(busy||observing)throw fail('BUSY');observing=true;
    try{return await operation('/api/v1/acp',{connectionId:credentials.connectionId,signal,timeoutMs:promptTimeoutMs},
      async(r,ctx)=>{await frames(r,ctx,notification);return{ended:true};});}
    finally{observing=false;}
  }
  async function close(){
    if(closing)return closing;closed=true;ready=false;
    const prior=credentials,password=gatewayPassword;credentials=null;ownedSessions.clear();
    for(const controller of controllers)controller.abort();controllers.clear();
    closing=(async()=>{if(prior)try{
      const response=await request(origin+'/api/v1/acp',{method:'DELETE',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(1000),
        headers:{Authorization:'Bearer '+password,'X-CodeBuddy-Request':'1','acp-connection-id':prior.connectionId}});
      try{await response.body?.cancel();}catch(_){}
    }catch(_){}gatewayPassword=null;})();
    return closing;
  }
  return{
    getState:()=>({source:SOURCE,scope:'dedicated-cli-workspace',connected:ready&&!closed,closed,busy,blocked,
      ownedSessionCount:ownedSessions.size,protocol:'official-http-api-beta',desktopTaskCoverage:false,permissionHandling:'cancel-and-disconnect'}),
    getHealth:({signal}={})=>rest('/api/v1/health',{signal}).then(data=>{
      if(!object(data)||data.status!=='ok')throw fail('INVALID_RESPONSE');
      return{source:SOURCE,scope:'gateway-only',reachable:true,status:'ok'};
    }),
    listSessions:async({signal}={})=>{
      const data=await rest('/api/v1/sessions?cwd='+encodeURIComponent(workspaceDir),{signal});
      if(!object(data)||!Array.isArray(data.sessions)||data.sessions.length>2000)throw fail('INVALID_RESPONSE');
      const sessions=data.sessions.map(row=>{if(!object(row)||!validId(row.id)||row.cwd!==undefined&&row.cwd!==workspaceDir)throw fail('UNSAFE_SCOPE');
        return{id:row.id,name:safeText(row.name),createdAt:validTime(row.createdAt)?row.createdAt:null,updatedAt:validTime(row.updatedAt)?row.updatedAt:null,
          messageCount:Number.isSafeInteger(row.messageCount)&&row.messageCount>=0?row.messageCount:null,isCurrent:typeof row.isCurrent==='boolean'?row.isCurrent:null,
          state:typeof row.status==='string'&&/^[a-z_-]{1,40}$/.test(row.status)?row.status:'unknown'};});
      return{source:SOURCE,scope:'cli-workspace-sessions-not-desktop-tasks',sessions};
    },
    listTasks:async({signal}={})=>{
      const data=await rest('/api/v1/jobs?all=true&cwd='+encodeURIComponent(workspaceDir),{signal});
      if(!object(data)||!Array.isArray(data.jobs)||data.jobs.length>2000)throw fail('INVALID_RESPONSE');
      const tasks=data.jobs.map(row=>{if(!object(row)||!validId(row.id)||row.cwd!==workspaceDir)throw fail('UNSAFE_SCOPE');
        return{id:row.id,name:safeText(row.name),state:JOB_STATES.has(row.state)?row.state:'unknown',
          startedAt:validTime(row.startedAt)?row.startedAt:null,updatedAt:validTime(row.updatedAt)?row.updatedAt:null};});
      return{source:SOURCE,scope:'cli-agent-jobs-not-desktop-tasks',tasks};
    },
    getDaemonStatus:async({signal}={})=>{const data=await rest('/api/v1/daemon/status',{signal});if(!object(data))throw fail('INVALID_RESPONSE');
      return{source:SOURCE,scope:'cli-daemon',reachable:true,statusSchemaVerified:false,running:null};},
    connect,createSession,sendMessage,subscribeNotifications,
    async cancel({sessionId}={}){assertOwned(sessionId);await rawCancel(sessionId);return{requested:true,completion:'not-confirmed'};},close
  };
}
module.exports={createWorkBuddyLocalCliClient,loopbackOrigin};
