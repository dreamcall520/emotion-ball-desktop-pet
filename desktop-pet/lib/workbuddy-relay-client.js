'use strict';
const { randomUUID } = require('node:crypto');
const SAFE = new Set(['AUTHORIZATION_REQUIRED','INSUFFICIENT_SCOPE','ASSISTANT_OFFLINE','UNKNOWN_OUTCOME','INVALID_RESPONSE','RATE_LIMITED',
  'TIMEOUT','CANCELLED','SERVICE_UNAVAILABLE','CONNECTION_FAILED','INVALID_REQUEST','TOKEN_SERVICE_FAILED','TOKEN_TIMEOUT','TOKEN_STORE_FAILED','PERMISSION_REQUIRED','APP_NOT_CONFIGURED','INVALID_INPUT','RESPONSE_TOO_LARGE','REDIRECT_REJECTED','HTTP_ERROR','API_ERROR','BUSY']);
const fail = code => Object.assign(new Error(code), { code, ...(code === 'UNKNOWN_OUTCOME' ? { outcome:'unknown',retryable:false } : {}) });
function relayOrigin(raw, diagnostic = false) {
  let url; try { url=new URL(raw); } catch (_) { throw fail('INVALID_REQUEST'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || diagnostic && url.protocol === 'http:' && url.hostname === '127.0.0.1')) throw fail('INVALID_REQUEST');
  if (url.protocol === 'https:' && (['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.port)) throw fail('INVALID_REQUEST');
  return url.origin;
}
function createWorkBuddyRelayClient({ baseUrl, diagnostic = false, fetch:request=globalThis.fetch, timeoutMs=15000 } = {}) {
  const origin=relayOrigin(baseUrl,diagnostic);
  if (typeof request !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>60000) throw fail('INVALID_REQUEST');
  let sessionToken=null,closed=false;const controllers=new Set();
  async function call(route,body,{signal,sending=false,publicRequest=false}={}) {
    if(closed)throw fail('CLOSED');if(!publicRequest&&!sessionToken)throw fail('AUTHORIZATION_REQUIRED');
    if(signal?.aborted)throw fail('CANCELLED');
    const controller=new AbortController();controllers.add(controller);let reason=null,reader,rejectAbort;
    const aborted=new Promise((_,reject)=>{rejectAbort=reject;});
    const cancelled=()=>{if(!reason)reason='CANCELLED';rejectAbort(fail(sending?'UNKNOWN_OUTCOME':reason));try{if(reader)void Promise.resolve(reader.cancel()).catch(()=>{});}catch(_){};};
    controller.signal.addEventListener('abort',cancelled,{once:true});
    const cancel=()=>{reason='CANCELLED';controller.abort();};signal?.addEventListener('abort',cancel,{once:true});
    let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reason='TIMEOUT';controller.abort();reject(fail(sending?'UNKNOWN_OUTCOME':'TIMEOUT'));},timeoutMs);});
    const operation=(async()=>{try{
      const response=await request(origin+route,{method:body===undefined?'GET':'POST',redirect:'manual',cache:'no-store',signal:controller.signal,
        headers:{Accept:'application/json','X-Qiuqiu-Client':'desktop-v1',...(body===undefined?{}:{'Content-Type':'application/json'}),...(sessionToken&&!publicRequest?{Authorization:'Bearer '+sessionToken}:{})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      if(response.redirected||response.status>=300&&response.status<400)throw fail(sending?'UNKNOWN_OUTCOME':'INVALID_RESPONSE');
      if(Number(response.headers?.get?.('content-length'))>512*1024)throw fail('INVALID_RESPONSE');
      reader=response.body?.getReader();if(!reader)throw fail('INVALID_RESPONSE');const chunks=[];let size=0;
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>512*1024)throw fail('INVALID_RESPONSE');chunks.push(value);}
      let value;try{value=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));}catch(_){throw fail('INVALID_RESPONSE');}
      if(response.status!==200){const code=SAFE.has(value?.error)?value.error:'SERVICE_UNAVAILABLE';throw Object.assign(fail(code),{remoteRejection:true});}
      return value;
    }catch(e){if(sending&&!e?.remoteRejection)throw fail('UNKNOWN_OUTCOME');if(reason)throw fail(sending?'UNKNOWN_OUTCOME':reason);throw SAFE.has(e?.code)?fail(e.code):fail('CONNECTION_FAILED');}})();
    try{return await Promise.race([operation,timeout,aborted]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',cancelled);controllers.delete(controller);try{if(reader)void Promise.resolve(reader.cancel()).catch(()=>{});reader?.releaseLock();}catch(_){} }
  }
  async function beginAuthorization(){
    const value=await call('/v1/connect',{}, {publicRequest:true});
    let url;try{url=new URL(value.authorizationUrl);}catch(_){throw fail('INVALID_RESPONSE');}
    if(!/^[A-Za-z0-9_-]{32,128}$/.test(value.sessionToken||'')||url.origin!=='https://www.workbuddy.cn'||url.pathname!=='/openapi/v2/authorize'||
       url.username||url.password||url.hash||!url.searchParams.get('state'))throw fail('INVALID_RESPONSE');
    sessionToken=value.sessionToken;return{authorizationUrl:url.href,expiresAt:value.expiresAt};
  }
  async function getConnectionState(options){if(!sessionToken)return{connected:false,pending:false};const v=await call('/v1/status',undefined,options);return{connected:v.connected===true,pending:v.pending===true,scopes:Array.isArray(v.scopes)?v.scopes.filter(s=>typeof s==='string'&&s.startsWith('user.')):[],expiresAt:Number.isFinite(v.expiresAt)?v.expiresAt:null};}
  const rpc=async(method,args={},options={})=>(await call('/v1/rpc',{method,...args},options)).result;
  return{beginAuthorization,getConnectionState,
    getAssistantStatus:options=>rpc('assistant-status',{},options),
    listTasks:({page=1,size=20,signal}={})=>rpc('tasks',{page,size},{signal}),
    listMessages:({afterMessageId,offset=0,limit=20,signal}={})=>rpc('messages',{afterMessageId,offset,limit},{signal}),
    sendMessage:({content,requestId=randomUUID(),signal}={})=>rpc('send-text',{content,requestId},{signal,sending:true}),
    async disconnect(){try{if(sessionToken)await call('/v1/disconnect',{});}finally{sessionToken=null;}},
    close(){closed=true;sessionToken=null;for(const c of controllers)c.abort();controllers.clear();}
  };
}
module.exports={createWorkBuddyRelayClient,relayOrigin};
