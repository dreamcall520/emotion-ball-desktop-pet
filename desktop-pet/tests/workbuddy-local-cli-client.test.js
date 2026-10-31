'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createWorkBuddyLocalCliClient}=require('../lib/workbuddy-local-cli-client');
const BASE='http://127.0.0.1:48711',PASSWORD='synthetic-local-gateway-password',SESSION_TOKEN='synthetic-private-acp-token';
const WORKSPACE='/private/qiuqiu-cli-workspace',SESSION='owned-cli-session',CONNECTION='owned-acp-connection';
const rpc=(id,result)=>({jsonrpc:'2.0',id,result});
const update=(type,extra={},sessionId=SESSION)=>({jsonrpc:'2.0',method:'session/update',params:{sessionId,update:{sessionUpdate:type,...extra}}});
function sse(packets,{ndjson=false,fragment=false}={}){
 const text=packets.map(p=>ndjson?JSON.stringify(p)+'\n':'data: '+JSON.stringify(p)+'\r\n\r\n').join('');
 const bytes=Buffer.from(text);
 const stream=fragment?new ReadableStream({start(c){for(let i=0;i<bytes.length;i++)c.enqueue(bytes.subarray(i,i+1));c.close();}}):text;
 return new Response(stream,{headers:{'Content-Type':'text/event-stream'}});
}
function harness(options={}){
 const calls=[],events=[];
 const client=createWorkBuddyLocalCliClient({baseUrl:BASE,gatewayPassword:PASSWORD,workspaceDir:WORKSPACE,
  requestTimeoutMs:1000,promptTimeoutMs:1000,onEvent:event=>events.push(event),...options.client,
  fetch:async(url,config)=>{
   assert.equal(url.startsWith(BASE+'/'),true);assert.equal(config.redirect,'manual');
   assert.equal(config.headers.Authorization,'Bearer '+PASSWORD);assert.equal(config.headers['X-CodeBuddy-Request'],'1');
   assert.equal(url.includes(PASSWORD),false);assert.equal(url.includes(SESSION_TOKEN),false);
   const packet=config.body?JSON.parse(config.body):null;
   const call={url,config,packet};calls.push(call);
   if(options.reply){const result=await options.reply(call);if(result!==undefined)return result;}
   if(url.endsWith('/health'))return Response.json({data:{status:'ok',authenticated:true,apiKey:PASSWORD}});
   if(url.includes('/sessions?'))return Response.json({data:{sessions:[{id:'cli-history-1',name:'Fixture',createdAt:1,updatedAt:2,messageCount:3,isCurrent:false,cwd:WORKSPACE,status:'idle',token:SESSION_TOKEN}]}});
   if(url.includes('/jobs?'))return Response.json({data:{jobs:[{id:'cli-job-1',name:'Fixture job',state:'working',cwd:WORKSPACE,startedAt:1,updatedAt:2,exec:'private shell',token:SESSION_TOKEN}]}});
   if(url.endsWith('/daemon/status'))return Response.json({data:{unverifiedServerShape:true,password:PASSWORD}});
   if(url.endsWith('/acp/connect'))return Response.json({connectionId:CONNECTION,sessionToken:SESSION_TOKEN});
   if(config.method==='DELETE')return Response.json({data:{disconnected:true}});
   assert.equal(config.headers['acp-connection-id'],CONNECTION);
   if(config.method==='GET')return sse([]);
   if(packet.method==='initialize')return sse([rpc(packet.id,{connectionId:CONNECTION,protocolVersion:'1',serverInfo:{name:'Fixture'}})]);
   if(packet.method==='session/new')return sse([rpc(packet.id,{sessionId:SESSION,modes:{currentModeId:'dontAsk'},models:{currentModelId:'cli-default-model'}})]);
   if(packet.method==='session/cancel')return new Response(null,{status:204});
   if(packet.method==='session/prompt')return sse([update('agent_message_chunk',{content:{type:'text',text:'你好'}}),update('session_end',{stopReason:'end_turn'}),rpc(packet.id,{stopReason:'end_turn'})]);
   throw Error('Unknown fixture route');
  }});
 return{client,calls,events};
}
async function chat(h){await h.client.connect();return h.client.createSession();}
function noSecrets(value){const raw=JSON.stringify(value);assert.equal(raw.includes(PASSWORD),false);assert.equal(raw.includes(SESSION_TOKEN),false);}

test('vendor身份查询只投影是否登录，不泄露原始token或用户信息，不自动触发登录',async()=>{
 for(const userInfo of [undefined,{userId:'private-user',userName:'PRIVATE_NAME',token:'PRIVATE_TOKEN',accessToken:'PRIVATE_TOKEN'}]){
  const h=harness({reply:c=>c.packet?.method==='_codebuddy.ai/getUserInfo'?sse([rpc(c.packet.id,{userInfo})]):undefined});
  await h.client.connect();
  assert.deepEqual(await h.client.getVendorAccount(),{authenticated:!!userInfo,...(userInfo?{accountKey:createHash('sha256').update('codebuddy:'+userInfo.userId).digest('hex')}:{}),liveEntitlementVerified:false});
  assert.equal(h.calls.some(x=>x.packet?.method==='authenticate'),false);
  assert.deepEqual(h.events,[]);await h.client.close();
 }
});

test('只恢复App明确记录且实际cwd匹配的旧session，检查loadSession能力和dontAsk模式，不重放到UI',async()=>{
 const h=harness({client:{restorableSessionIds:[SESSION]},reply:c=>{
  if(c.packet?.method==='initialize')return sse([rpc(c.packet.id,{protocolVersion:1,agentCapabilities:{loadSession:true}})]);
  if(c.url.includes('/sessions?'))return Response.json({data:{sessions:[{id:SESSION,cwd:WORKSPACE}]}});
  if(c.packet?.method==='session/load')return sse([update('agent_message_chunk',{content:{type:'text',text:'old own message'}}),rpc(c.packet.id,{modes:{currentModeId:'dontAsk'},models:{currentModelId:'cli-default-model'}})]);
 }});
 await h.client.connect();
 assert.deepEqual(await h.client.loadSession({sessionId:SESSION}),{sessionId:SESSION,restored:true,modelSource:'cli-default',currentModelId:'cli-default-model'});
 assert.deepEqual(h.events,[]);
 assert.deepEqual(h.calls.find(x=>x.packet?.method==='session/load').packet.params,{sessionId:SESSION,cwd:WORKSPACE,mcpServers:[]});
 assert.equal(h.calls.some(x=>x.packet?.method==='session/new'),false);
 assert.equal((await h.client.sendMessage({sessionId:SESSION,content:'new message'})).completion,'complete');
 await h.client.close();
});
test('拒绝未记录session、不支持load、不在专用cwd索引或显式不匹配cwd，失败不偷偷新建会话',async()=>{
 for(const kind of ['unrecorded','unsupported','missing','foreign']){
  const h=harness({client:{restorableSessionIds:kind==='unrecorded'?[]:[SESSION]},reply:c=>{
   if(c.packet?.method==='initialize')return sse([rpc(c.packet.id,{protocolVersion:1,agentCapabilities:{loadSession:kind!=='unsupported'}})]);
   if(c.url.includes('/sessions?'))return Response.json({data:{sessions:kind==='missing'?[]:[{id:SESSION,...(kind==='missing-cwd'?{}:{cwd:kind==='foreign'?'/private/foreign':WORKSPACE})}]}});
  }});
  await h.client.connect();await assert.rejects(h.client.loadSession({sessionId:SESSION}),{code:kind==='unsupported'?'UNSUPPORTED_API':'UNSAFE_SCOPE'});
  assert.equal(h.calls.some(x=>x.packet?.method==='session/load'||x.packet?.method==='session/new'),false);await h.client.close();
 }
});
test('恢复返回不安全模式则断开，不能给旧session发送新消息',async()=>{
 const h=harness({client:{restorableSessionIds:[SESSION]},reply:c=>{
  if(c.packet?.method==='initialize')return sse([rpc(c.packet.id,{protocolVersion:1,agentCapabilities:{loadSession:true}})]);
  if(c.url.includes('/sessions?'))return Response.json({data:{sessions:[{id:SESSION,cwd:WORKSPACE}]}});
  if(c.packet?.method==='session/load')return sse([rpc(c.packet.id,{modes:{currentModeId:'bypassPermissions'}})]);
 }});
 await h.client.connect();await assert.rejects(h.client.loadSession({sessionId:SESSION}),{code:'UNSAFE_CONFIG'});
 await assert.rejects(h.client.sendMessage({sessionId:SESSION,content:'should not send'}),{code:'CLOSED'});await h.client.close();
});
test('官方单项目索引可省略cwd字段，但始终只查询固定专用workspace且要求own id存在',async()=>{
 const h=harness({client:{restorableSessionIds:[SESSION]},reply:c=>{
  if(c.packet?.method==='initialize')return sse([rpc(c.packet.id,{protocolVersion:1,agentCapabilities:{loadSession:true}})]);
  if(c.url.includes('/sessions?'))return Response.json({data:{sessions:[{id:SESSION}]}});
  if(c.packet?.method==='session/load')return sse([rpc(c.packet.id,{modes:{currentModeId:'dontAsk'}})]);
 }});
 await h.client.connect();assert.equal((await h.client.loadSession({sessionId:SESSION})).restored,true);
 assert.equal(h.calls.find(x=>x.url.includes('/sessions?')).url,BASE+'/api/v1/sessions?cwd='+encodeURIComponent(WORKSPACE));
 assert.equal(h.calls.some(x=>x.url.includes('cwd=*')),false);await h.client.close();
});
test('显式官方登录URL只交主进程回调，成功必须userinfo身份回执且不进入聊天事件',async()=>{
 const authUrl='https://copilot.tencent.com/login?state=PRIVATE_STATE',urls=[];
 const h=harness({reply:c=>c.packet?.method==='authenticate'?sse([
  {jsonrpc:'2.0',method:'_codebuddy.ai/authUrl',params:{authUrl}},
  rpc(c.packet.id,{_meta:{'codebuddy.ai/userinfo':{userId:'PRIVATE_USER',token:'PRIVATE_TOKEN'}}})]):undefined});
 await h.client.connect();
 assert.deepEqual(await h.client.authenticate({onAuthUrl:url=>urls.push(url)}),{authenticated:true});
 assert.deepEqual(urls,[authUrl]);assert.deepEqual(h.events,[]);
 assert.deepEqual(h.calls.find(c=>c.packet?.method==='authenticate').packet.params,{methodId:'internal'});
 await h.client.close();
});
test('登录拒绝非官方域名URL以及缺少用户身份的伪成功',async()=>{
 for(const raw of ['http://copilot.tencent.com/login','https://evil.example/login','https://user@copilot.tencent.com/login','https://copilot.tencent.com:8443/login']){
  const h=harness({reply:c=>c.packet?.method==='authenticate'?sse([{jsonrpc:'2.0',method:'_codebuddy.ai/authUrl',params:{authUrl:raw}},rpc(c.packet.id,{})]):undefined});
  await h.client.connect();await assert.rejects(h.client.authenticate({onAuthUrl:()=>assert.fail('invalid URL opened')}),{code:'UNSAFE_CONFIG'});await h.client.close();
 }
 const h=harness({reply:c=>c.packet?.method==='authenticate'?sse([rpc(c.packet.id,{})]):undefined});
 await h.client.connect();await assert.rejects(h.client.authenticate({onAuthUrl:()=>{}}),{code:'UNAUTHENTICATED'});await h.client.close();
});

test('only literal loopback origins and password headers, never remote/password URLs',()=>{
 for(const baseUrl of ['http://example.com:1234','http://localhost:1234','http://user:secret@127.0.0.1:1234','http://127.0.0.1:1234?password=x','http://127.0.0.1:1234/prefix','http://127.0.0.1'])
  assert.throws(()=>createWorkBuddyLocalCliClient({baseUrl,gatewayPassword:PASSWORD,workspaceDir:WORKSPACE}),{code:'INVALID_INPUT'});
 assert.throws(()=>createWorkBuddyLocalCliClient({baseUrl:BASE,gatewayPassword:PASSWORD+'\n',workspaceDir:WORKSPACE}),{code:'INVALID_INPUT'});
});

test('REST projections distinguish dedicated CLI sessions/jobs from Desktop tasks and gateway from vendor login',async()=>{
 const h=harness();
 assert.deepEqual(await h.client.getHealth(),{source:'workbuddy-local-cli',scope:'gateway-only',reachable:true,status:'ok'});
 const sessions=await h.client.listSessions(),tasks=await h.client.listTasks(),daemon=await h.client.getDaemonStatus();
 assert.equal(sessions.scope,'cli-workspace-sessions-not-desktop-tasks');assert.equal(sessions.sessions[0].messageCount,3);
 assert.equal(tasks.scope,'cli-agent-jobs-not-desktop-tasks');assert.equal(tasks.tasks[0].state,'working');
 assert.equal(daemon.statusSchemaVerified,false);assert.equal(daemon.running,null);
 assert.equal(h.calls.find(c=>c.url.includes('/sessions?')).url,BASE+'/api/v1/sessions?cwd='+encodeURIComponent(WORKSPACE));
 assert.equal(h.calls.find(c=>c.url.includes('/jobs?')).url,BASE+'/api/v1/jobs?all=true&cwd='+encodeURIComponent(WORKSPACE));
 noSecrets([sessions,tasks,daemon]);await h.client.close();
});

test('foreign workspace rows cannot be projected despite a scoped request',async()=>{
 const h=harness({reply:c=>c.url.includes('/sessions?')?Response.json({data:{sessions:[{id:'foreign',cwd:'/private/foreign'}]}}):undefined});
 await assert.rejects(h.client.listSessions(),{code:'UNSAFE_SCOPE'});await h.client.close();
});

test('ACP uses naked connect credentials, one initialize and disabled filesystem/terminal capabilities',async()=>{
 const h=harness();await h.client.connect();await h.client.connect();
 const init=h.calls.find(c=>c.packet?.method==='initialize').packet;
 assert.deepEqual(init.params.clientCapabilities,{fs:{readTextFile:false,writeTextFile:false},terminal:false});
 assert.equal(h.calls.filter(c=>c.url.endsWith('/acp/connect')).length,1);
 assert.equal(h.calls.filter(c=>c.packet?.method==='initialize').length,1);
 noSecrets(h.client.getState());assert.equal(h.client.getState().connected,true);await h.client.close();
});

test('dedicated new session, no history load or fake model catalog; streaming completion waits for prompt result',async()=>{
 const h=harness({reply:c=>c.packet?.method==='session/prompt'?sse([
  update('agent_message_chunk',{content:{type:'text',text:'你'}}),update('agent_thought_chunk',{content:{type:'text',text:'PRIVATE_REASONING'}}),
  update('agent_message_chunk',{content:{type:'text',text:'好'}}),update('session_end',{stopReason:'end_turn'}),rpc(c.packet.id,{stopReason:'end_turn'})],{fragment:true}):undefined});
 const session=await chat(h);assert.equal(session.modelSource,'cli-default');
 assert.deepEqual(h.calls.find(c=>c.packet?.method==='session/new').packet.params,{cwd:WORKSPACE,mcpServers:[]});
 const result=await h.client.sendMessage({sessionId:session.sessionId,content:'synthetic input'});
 assert.deepEqual(result,{sessionId:SESSION,text:'你好',stopReason:'end_turn',completion:'complete'});
 assert.deepEqual(h.events.map(e=>e.type),['delta','delta']);assert.equal(JSON.stringify(h.events).includes('PRIVATE_REASONING'),false);
 assert.equal(h.calls.some(c=>['authenticate','session/load','session/resume','session/set_model'].includes(c.packet?.method)),false);
 noSecrets([result,h.events]);await h.client.close();
});

test('only sessions created through this connection may prompt or cancel',async()=>{
 const h=harness();await chat(h);const before=h.calls.length;
 await assert.rejects(h.client.sendMessage({sessionId:'foreign-session',content:'never send'}),{code:'UNSAFE_SCOPE'});
 await assert.rejects(h.client.cancel({sessionId:'foreign-session'}),{code:'UNSAFE_SCOPE'});
 assert.equal(h.calls.length,before);await h.client.close();
});

test('bypass or missing permission mode prevents any prompt',async()=>{
 const h=harness({reply:c=>c.packet?.method==='session/new'?sse([rpc(c.packet.id,{sessionId:SESSION,modes:{currentModeId:'bypassPermissions'}})]):undefined});
 await h.client.connect();await assert.rejects(h.client.createSession(),{code:'UNSAFE_CONFIG'});
 assert.equal(h.calls.some(c=>c.packet?.method==='session/prompt'),false);assert.equal(h.client.getState().closed,true);
});

test('permission interruption cancels and disconnects, never guesses interruptionId to approve/deny mapping',async()=>{
 const h=harness({reply:c=>c.packet?.method==='session/prompt'?sse([update('interruption_request',{
  interruptionId:'different-kind-of-id',reason:'PRIVATE_TOOL_ARGUMENTS',options:['allow','allowAll','deny'],toolInput:{password:PASSWORD}})]):undefined});
 await chat(h);await assert.rejects(h.client.sendMessage({sessionId:SESSION,content:'synthetic'}),{code:'TOOL_BLOCKED'});
 await h.client.close();
 assert.equal(h.calls.some(c=>c.packet?.method==='session/cancel'),true);
 assert.equal(h.calls.some(c=>c.packet?.method==='_codebuddy.ai/resolveInterruption'),false);
 assert.equal(h.calls.some(c=>c.config.method==='DELETE'),true);
 assert.equal(JSON.stringify(h.events).includes('PRIVATE_TOOL_ARGUMENTS'),false);noSecrets(h.events);
});

test('unexpected server request or tool execution update fails closed',async t=>{
 for(const kind of ['request','tool'])await t.test(kind,async()=>{
  const h=harness({reply:c=>c.packet?.method==='session/prompt'?sse([kind==='request'
   ?{jsonrpc:'2.0',id:500,method:'fs/readTextFile',params:{path:'PRIVATE'}}:update('tool_call',{toolCallId:'tool-1',input:'PRIVATE'})]):undefined});
  await chat(h);await assert.rejects(h.client.sendMessage({sessionId:SESSION,content:'synthetic'}),{code:'TOOL_BLOCKED'});
  await h.client.close();assert.equal(JSON.stringify(h.events).includes('PRIVATE'),false);
 });
});

test('single prompt network/invalid/truncated response is unknown, never retried',async t=>{
 for(const kind of ['network','missing-result','bad-json'])await t.test(kind,async()=>{
  const h=harness({reply:c=>{if(c.packet?.method!=='session/prompt')return;
   if(kind==='network')throw Error(PASSWORD);
   return kind==='missing-result'?sse([update('agent_message_chunk',{content:{type:'text',text:'partial'}})]):new Response('data: {broken\n\n',{headers:{'Content-Type':'text/event-stream'}});
  }});
  await chat(h);await assert.rejects(h.client.sendMessage({sessionId:SESSION,content:'synthetic'}),error=>error.code==='UNKNOWN_OUTCOME'&&error.retryable===false&&!error.message.includes(PASSWORD));
  assert.equal(h.calls.filter(c=>c.packet?.method==='session/prompt').length,1);assert.equal(h.client.getState().closed,true);
 });
});

test('explicit cancel is no-id notification and does not claim generation finished',async()=>{
 const h=harness();await chat(h);assert.deepEqual(await h.client.cancel({sessionId:SESSION}),{requested:true,completion:'not-confirmed'});
 const cancel=h.calls.find(c=>c.packet?.method==='session/cancel').packet;assert.equal(Object.hasOwn(cancel,'id'),false);await h.client.close();
});

test('GET notification observation is scoped, supports NDJSON and cannot overlap prompt',async()=>{
 let started,finish;const reading=new Promise(r=>{started=r;});
 const h=harness({reply:c=>c.config.method==='GET'&&c.url.endsWith('/acp')?new Response(new ReadableStream({start(controller){
  controller.enqueue(Buffer.from(JSON.stringify(update('agent_message_chunk',{content:{type:'text',text:'foreign'}},'foreign-session'))+'\n'));
  controller.enqueue(Buffer.from(JSON.stringify(update('agent_message_chunk',{content:{type:'text',text:'owned'}}))+'\n'));
  started();finish=()=>controller.close();} }),{headers:{'Content-Type':'text/event-stream'}}):undefined});
 await chat(h);const watching=h.client.subscribeNotifications();await reading;
 await assert.rejects(h.client.sendMessage({sessionId:SESSION,content:'not while observing'}),{code:'BUSY'});
 finish();await watching;assert.deepEqual(h.events.map(e=>e.text),['owned']);await h.client.close();
});

test('close cancels stalled GET stream and disconnects only own ACP, without hanging or stopping gateway',async()=>{
 let readingStarted,cancelled=0;const reading=new Promise(r=>{readingStarted=r;});
 const h=harness({reply:c=>c.config.method==='GET'&&c.url.endsWith('/acp')?new Response(new ReadableStream({pull(){readingStarted();},cancel(){cancelled++;}},{highWaterMark:0}),{headers:{'Content-Type':'text/event-stream'}}):undefined});
 await chat(h);const watching=h.client.subscribeNotifications();const rejection=assert.rejects(watching,{code:'CANCELLED'});await reading;
 await h.client.close();await rejection;assert.equal(cancelled,1);assert.equal(h.calls.filter(c=>c.config.method==='DELETE').length,1);
 assert.equal(h.calls.some(c=>c.url.includes('/daemon/stop')||c.url.includes('/workers/')),false);
});

test('timeouts cover prompt body; oversized REST is bounded; preabort dispatches nothing',async()=>{
 const h=harness({client:{promptTimeoutMs:30},reply:c=>c.packet?.method==='session/prompt'?new Response(new ReadableStream({start(){}}),{headers:{'Content-Type':'text/event-stream'}}):undefined});
 await chat(h);await assert.rejects(h.client.sendMessage({sessionId:SESSION,content:'synthetic'}),{code:'UNKNOWN_OUTCOME'});
 const bounded=harness({reply:c=>c.url.endsWith('/health')?new Response('{}',{headers:{'Content-Length':String(1024*1024+1)}}):undefined});
 await assert.rejects(bounded.client.getHealth(),{code:'RESPONSE_TOO_LARGE'});await bounded.client.close();
 const pre=harness(),abort=new AbortController();abort.abort();await assert.rejects(pre.client.getHealth({signal:abort.signal}),{code:'CANCELLED'});
 assert.equal(pre.calls.length,0);await pre.client.close();
});

test('redirect does not forward password, and body errors never leak gateway/session secrets',async()=>{
 const h=harness({reply:()=>new Response(PASSWORD,{status:302,headers:{Location:'http://fixture.invalid/?token='+SESSION_TOKEN}})});
 await assert.rejects(h.client.getHealth(),error=>{noSecrets(error);return error.code==='INVALID_RESPONSE';});assert.equal(h.calls.length,1);await h.client.close();
});

test('connect remains unready until initialize finishes; a second connect never bypasses handshake',async()=>{
 let initializing,finishInit;const entered=new Promise(resolve=>{initializing=resolve;});
 const h=harness({reply:call=>{
  if(call.packet?.method!=='initialize')return;
  initializing();return new Promise(resolve=>{finishInit=()=>resolve(sse([rpc(call.packet.id,{connectionId:CONNECTION,protocolVersion:1})]));});
 }});
 const first=h.client.connect();await entered;
 const second=h.client.connect();assert.equal(h.client.getState().connected,false);
 await assert.rejects(h.client.createSession(),{code:'NOT_CONNECTED'});
 finishInit();await Promise.all([first,second]);
 assert.equal(h.calls.filter(call=>call.packet?.method==='initialize').length,1);
 assert.equal(h.client.getState().connected,true);await h.client.close();
});

test('permission-mode drift cancels the owned server turn and disconnects, not merely the local stream',async()=>{
 const h=harness({reply:call=>call.packet?.method==='session/prompt'?sse([
  update('current_mode_update',{currentModeId:'bypassPermissions'}),
  update('agent_message_chunk',{content:{type:'text',text:'must never appear after mode drift'}}),
  rpc(call.packet.id,{stopReason:'end_turn'})]):undefined});
 await chat(h);
 await assert.rejects(h.client.sendMessage({sessionId:SESSION,content:'synthetic prompt'}),{code:'UNSAFE_CONFIG'});
 await h.client.close();
 const cancels=h.calls.filter(call=>call.packet?.method==='session/cancel');
 assert.equal(cancels.length,1);assert.deepEqual(cancels[0].packet.params,{sessionId:SESSION});
 assert.equal(h.calls.filter(call=>call.config.method==='DELETE').length,1);
 assert.equal(h.events.some(event=>event.type==='delta'),false);
 assert.deepEqual(h.events.find(event=>event.type==='blocked'),{type:'blocked',code:'UNSAFE_CONFIG',scope:'dedicated-cli-workspace'});
 const before=h.calls.length;
 await assert.rejects(h.client.sendMessage({sessionId:SESSION,content:'must not continue'}),{code:'UNSAFE_CONFIG'});
 assert.equal(h.calls.length,before);assert.equal(h.client.getState().closed,true);
});

test('mode drift in GET notifications also cancels and disconnects instead of leaving the server live',async()=>{
 const h=harness({reply:call=>call.config.method==='GET'&&call.url.endsWith('/acp')?
  sse([update('current_mode_update',{currentModeId:'default'})]):undefined});
 await chat(h);await assert.rejects(h.client.subscribeNotifications(),{code:'UNSAFE_CONFIG'});await h.client.close();
 assert.equal(h.calls.filter(call=>call.packet?.method==='session/cancel').length,1);
 assert.equal(h.calls.filter(call=>call.config.method==='DELETE').length,1);
});

test('unknown requests cancel only an explicitly owned session; missing/foreign ids disconnect without guessing',async t=>{
 for(const kind of ['owned','foreign','missing'])await t.test(kind,async()=>{
  const params={path:'PRIVATE_TOOL_PATH',...(kind==='missing'?{}:{sessionId:kind==='owned'?SESSION:'foreign-session'})};
  const h=harness({reply:call=>call.packet?.method==='session/prompt'?
   sse([{jsonrpc:'2.0',id:701,method:'fs/readTextFile',params}]):undefined});
  await chat(h);await assert.rejects(h.client.sendMessage({sessionId:SESSION,content:'synthetic prompt'}),{code:'TOOL_BLOCKED'});await h.client.close();
  const cancels=h.calls.filter(call=>call.packet?.method==='session/cancel');
  assert.equal(cancels.length,kind==='owned'?1:0);
  if(kind==='owned')assert.deepEqual(cancels[0].packet.params,{sessionId:SESSION});
  assert.equal(h.calls.filter(call=>call.config.method==='DELETE').length,1);
  assert.equal(h.calls.some(call=>call.packet?.method==='_codebuddy.ai/resolveInterruption'),false);
  assert.equal(JSON.stringify(h.events).includes('PRIVATE_TOOL_PATH'),false);
 });
});
