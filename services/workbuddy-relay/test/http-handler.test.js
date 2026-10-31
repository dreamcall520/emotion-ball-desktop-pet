'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createRelayHandler}=require('../http-handler');
const {createWorkBuddyRelayClient}=require('../../../desktop-pet/lib/workbuddy-relay-client');
const CALLBACK='https://relay.example/oauth/workbuddy/callback';
const REQUEST='ef1480d7-f6ce-48c3-8436-318cff705d12';
function store(){const values=new Map();return{get:async k=>values.get(k),set:async(k,v)=>values.set(k,structuredClone(v)),delete:async k=>values.delete(k)};}
async function fixture(t,{ledger=store(),send,onCreateClient}={}){
 const auth=new Map();let posts=0;const secrets=[];
 const broker={beginAuthorization:async(id,scopes)=>{secrets.push(id);return{authorizationUrl:'https://www.workbuddy.cn/openapi/v2/authorize?state='+'S'.repeat(43),expiresAt:Date.now()+60000};},
 handleCallback:async(id,url)=>{assert.equal(new URL(url).origin,'https://relay.example');auth.set(id,true);return{connected:true};},
 getConnectionState:async id=>({connected:auth.has(id),scopes:['user.task.readable'],expiresAt:Date.now()+60000}),revoke:async id=>auth.delete(id)};
 const createClient=()=>{onCreateClient?.();return{getAssistantStatus:async()=>({online:true}),listTasks:async({page,size})=>({tasks:[{id:'task1',status:'working'}],pagination:{page,size,total:1}}),
 listMessages:async()=>({messages:[],partial:true}),sendMessage:async()=>{posts++;if(send)return send();return{messageId:'msg1'};}};};
 let handler=createRelayHandler({broker,createClient,ledgerStore:ledger,callbackUrl:CALLBACK});
 const restartRouter=()=>{handler=createRelayHandler({broker,createClient,ledgerStore:ledger,callbackUrl:CALLBACK});};
 const server=http.createServer((req,res)=>void handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 const origin='http://127.0.0.1:'+server.address().port;
 const client=createWorkBuddyRelayClient({baseUrl:origin,diagnostic:true});t.after(()=>client.close());
 async function authorize(){const start=await client.beginAuthorization();assert.equal(JSON.stringify(start).includes(secrets[0]),false);
 const state=new URL(start.authorizationUrl).searchParams.get('state');const r=await fetch(origin+'/oauth/workbuddy/callback?state='+state+'&code=synthetic');assert.equal(r.status,200);assert.equal((await client.getConnectionState()).connected,true);return start;}
 return{origin,client,authorize,posts:()=>posts,ledger,secrets,restartRouter};
}
test('real relay HTTP binds callback, reads cloud tasks and sends one persisted message for repeated intent',async t=>{
 const f=await fixture(t);assert.equal((await f.client.getConnectionState()).connected,false);await f.authorize();
 const tasks=await f.client.listTasks({page:2,size:10});assert.deepEqual(tasks.pagination,{page:2,size:10,total:1});
 const [a,b]=await Promise.all([f.client.sendMessage({content:'synthetic test',requestId:REQUEST}),f.client.sendMessage({content:'synthetic test',requestId:REQUEST})]);
 assert.equal(a.messageId,'msg1');assert.deepEqual(a,b);assert.equal(f.posts(),1);assert.equal(a.completion,'not-confirmed');
 await assert.rejects(f.client.sendMessage({content:'different',requestId:REQUEST}),{code:'INVALID_REQUEST'});
 await f.client.disconnect();assert.equal((await f.client.getConnectionState()).connected,false);
});
test('uncertain send retains intent and never retries even after a new router process',async t=>{
 const ledger=store(),f=await fixture(t,{ledger,send:()=>{throw Error('secret-provider-message');}});await f.authorize();
 await assert.rejects(f.client.sendMessage({content:'hello',requestId:REQUEST}),e=>e.code==='UNKNOWN_OUTCOME'&&e.retryable===false&&!e.message.includes('secret'));
 f.restartRouter();await assert.rejects(f.client.sendMessage({content:'hello',requestId:REQUEST}),{code:'UNKNOWN_OUTCOME'});assert.equal(f.posts(),1);
});
test('rejects unknown callback state, browser origin, absent app session and unsupported permissions',async t=>{
 const f=await fixture(t);
 assert.equal((await fetch(f.origin+'/oauth/workbuddy/callback?state=unknown&code=synthetic')).status,400);
 assert.equal((await fetch(f.origin+'/v1/connect',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json','X-Qiuqiu-Client':'desktop-v1'},body:'{}'})).status,403);
 assert.equal((await fetch(f.origin+'/v1/status',{headers:{'X-Qiuqiu-Client':'desktop-v1'}})).status,401);
 await f.authorize();const token=f.secrets[0];
 const r=await fetch(f.origin+'/v1/rpc',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Qiuqiu-Client':'desktop-v1'},body:JSON.stringify({method:'permission_response',content:'approve-all'})});
 assert.equal(r.status,400);assert.equal((await r.json()).error,'INVALID_REQUEST');assert.equal(f.posts(),0);
});
test('desktop relay enforces HTTPS and never returns own session token to renderer contract',async t=>{
 assert.throws(()=>createWorkBuddyRelayClient({baseUrl:'http://example.com'}),{code:'INVALID_REQUEST'});
 assert.throws(()=>createWorkBuddyRelayClient({baseUrl:'https://user:secret@example.com'}),{code:'INVALID_REQUEST'});
 const f=await fixture(t);const auth=await f.client.beginAuthorization();assert.equal(Object.hasOwn(auth,'sessionToken'),false);
 assert.equal(new URL(auth.authorizationUrl).searchParams.has('sessionToken'),false);
});
test('non-idempotent timeout or redirect is uncertain and does not retry',async()=>{
 let calls=0;
 const fake=async(url)=>{calls++;if(url.endsWith('/connect'))return Response.json({sessionToken:'A'.repeat(43),authorizationUrl:'https://www.workbuddy.cn/openapi/v2/authorize?state=test'});return new Response('{}',{status:302});};
 const c=createWorkBuddyRelayClient({baseUrl:'https://relay.example',fetch:fake});await c.beginAuthorization();await assert.rejects(c.sendMessage({content:'hello'}),{code:'UNKNOWN_OUTCOME'});assert.equal(calls,2);c.close();
});

test('concurrent same intent with different content is rejected before returning another payload receipt',async t=>{
 let finishSend,secondRequestArrived,created=0;
 const arrived=new Promise(resolve=>{secondRequestArrived=resolve;});
 const f=await fixture(t,{onCreateClient:()=>{if(++created===2)secondRequestArrived();},
  send:()=>new Promise(resolve=>{finishSend=resolve;})});
 await f.authorize();
 const first=f.client.sendMessage({content:'first explicit synthetic payload',requestId:REQUEST});
 while(!finishSend)await new Promise(resolve=>setImmediate(resolve));
 const second=f.client.sendMessage({content:'different explicit synthetic payload',requestId:REQUEST});
 const rejected=assert.rejects(second,{code:'INVALID_REQUEST'});
 await arrived;finishSend({messageId:'first-payload-only'});
 assert.equal((await first).messageId,'first-payload-only');await rejected;
 assert.equal(f.posts(),1);
});

test('truncated or oversized accepted relay response is UNKNOWN_OUTCOME and never resends',async()=>{
 for(const kind of ['truncated','oversized']){
  let posts=0;
  const fake=async url=>{
   if(url.endsWith('/connect'))return Response.json({sessionToken:'A'.repeat(43),authorizationUrl:'https://www.workbuddy.cn/openapi/v2/authorize?state='+'S'.repeat(43)});
   posts++;
   return kind==='truncated'?new Response('{"result":{"state":"accepted","messageId":"synthetic-secret'):
    new Response('{}',{headers:{'Content-Length':String(512*1024+1)}});
  };
  const client=createWorkBuddyRelayClient({baseUrl:'https://relay.example',fetch:fake});
  try{
   await client.beginAuthorization();
   await assert.rejects(client.sendMessage({content:'synthetic explicit payload',requestId:REQUEST}),error=>
    error.code==='UNKNOWN_OUTCOME'&&error.outcome==='unknown'&&error.retryable===false&&!error.message.includes('synthetic-secret'));
   assert.equal(posts,1);
  }finally{client.close();}
 }
});

test('signal abort or client close immediately cancels a stalled response body without waiting for timeout',async t=>{
 for(const mode of ['signal','close'])await t.test(mode,async()=>{
  let readingStarted,bodyCancelled=0,requests=0;
  const reading=new Promise(resolve=>{readingStarted=resolve;});
  const client=createWorkBuddyRelayClient({baseUrl:'https://relay.example',timeoutMs:2000,fetch:async url=>{
   requests++;
   if(url.endsWith('/connect'))return Response.json({sessionToken:'A'.repeat(43),authorizationUrl:'https://www.workbuddy.cn/openapi/v2/authorize?state='+'S'.repeat(43)});
   return new Response(new ReadableStream({pull(){readingStarted();},cancel(){bodyCancelled++;}},{highWaterMark:0}));
  }});
  let deadline;
  try{
   await client.beginAuthorization();
   const controller=new AbortController();
   const pending=client.getAssistantStatus({signal:controller.signal});
   const rejected=assert.rejects(pending,error=>error.code==='CANCELLED'&&error.message==='CANCELLED');
   await reading;
   if(mode==='signal')controller.abort(new Error('synthetic-secret-cancel-reason'));else client.close();
   await Promise.race([rejected,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Cancellation stalled until request timeout')),250);})]);
   assert.equal(bodyCancelled,1);assert.equal(requests,2);
   if(mode==='close')await assert.rejects(client.getAssistantStatus(),{code:'CLOSED'});
  }finally{clearTimeout(deadline);client.close();}
 });
});

test('pre-aborted signal never dispatches a read or non-idempotent send',async()=>{
 let requests=0;
 const client=createWorkBuddyRelayClient({baseUrl:'https://relay.example',fetch:async()=>{
  requests++;
  return Response.json({sessionToken:'A'.repeat(43),authorizationUrl:'https://www.workbuddy.cn/openapi/v2/authorize?state='+'S'.repeat(43)});
 }});
 try{
  await client.beginAuthorization();assert.equal(requests,1);
  const controller=new AbortController();controller.abort(new Error('synthetic-secret-preabort'));
  await assert.rejects(client.getAssistantStatus({signal:controller.signal}),{code:'CANCELLED',message:'CANCELLED'});
  await assert.rejects(client.sendMessage({content:'must not dispatch',requestId:REQUEST,signal:controller.signal}),{code:'CANCELLED',message:'CANCELLED'});
  assert.equal(requests,1);
 }finally{client.close();}
});
