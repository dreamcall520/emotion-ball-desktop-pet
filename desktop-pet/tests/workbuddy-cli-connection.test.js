const test=require('node:test'),assert=require('node:assert/strict');
const {createWorkBuddyCliConnection}=require('../lib/workbuddy-cli-connection');
function fixture(options={}){let posted=0,record=null,clientOptions=null;const client={getHealth:async()=>({reachable:true}),listSessions:async()=>({sessions:[{id:'s1',name:'dedicated',state:'unknown'}]}),listTasks:async()=>({tasks:[{id:'j1',state:'done'}]}),connect:async()=>({connected:true}),createSession:async()=>({sessionId:'owned',currentModelId:null}),sendMessage:async()=>{posted++;return{text:'reply',completion:'complete'};},cancel:async()=>({requested:true}),close:async()=>{},...options.client};const connection=createWorkBuddyCliConnection({createClient:options=>{clientOptions=options;return client;},store:{read:()=>record,write:v=>record=v},...options});return{client,connection,posted:()=>posted,record:()=>record,clientOptions:()=>clientOptions};}
test('CLI scopes sessions and jobs honestly and connects one dedicated session',async()=>{let created=0;const f=fixture({client:{createSession:async()=>{created++;return{sessionId:'own'};}}});await f.connection.configure({});await f.connection.refresh();let s=f.connection.getState();assert.equal(s.desktopTasksIncluded,false);assert.equal(s.connected,false);assert.equal(s.gatewayReachable,true);assert.equal(s.tasks.length,1);await f.connection.connect();await f.connection.connect();assert.equal(created,1);assert.equal(f.connection.getState().currentModelId,null);await f.connection.close();});
test('durable pending intent precedes prompt and completion clears it',async()=>{const f=fixture();await f.connection.configure({});await f.connection.connect();f.client.sendMessage=async()=>{assert.equal(f.record().pendingSend,true);return{text:'actual reply',completion:'complete'};};await f.connection.send('hello');assert.equal(f.record().pendingSend,false);assert.equal(f.connection.getState().messages[1].text,'actual reply');assert.equal(f.connection.getState().sendOutcome,'complete');await f.connection.close();});
test('failed prompt is unknown and cannot automatically resend',async()=>{const f=fixture();await f.connection.configure({});await f.connection.connect();let calls=0;f.client.sendMessage=async()=>{calls++;throw Object.assign(Error(),{code:'UNKNOWN_OUTCOME'});};await f.connection.send('hello');await f.connection.send('again');assert.equal(calls,1);assert.equal(f.connection.getState().sendOutcome,'unknown');f.connection.confirmUnknownReviewed();assert.equal(f.connection.getState().sendOutcome,null);await f.connection.close();});
test('restarting with pending intent keeps send locked',async()=>{const f=fixture({store:{read:()=>({pendingSend:true}),write(){}}});await f.connection.configure({});await f.connection.connect();await f.connection.send('hello');assert.equal(f.posted(),0);await f.connection.close();});
test('no durable intent storage means no prompt crosses boundary when store fails',async()=>{const f=fixture({store:{read:()=>null,write(){throw Error('disk');}}});await f.connection.configure({});await f.connection.connect();await f.connection.send('hello');assert.equal(f.posted(),0);await f.connection.close();});
test('cancel is available while prompt is pending',async()=>{let resolve,cancels=0;const f=fixture({client:{sendMessage:()=>new Promise(r=>resolve=r),cancel:async()=>{cancels++;resolve({completion:'cancelled',text:''});}}});await f.connection.configure({});await f.connection.connect();const flight=f.connection.send('hello');await new Promise(r=>setImmediate(r));assert.equal(f.connection.getState().busy,true);await f.connection.cancel();await flight;assert.equal(cancels,1);assert.equal(f.connection.getState().sendOutcome,'cancelled');await f.connection.close();});
test('late prompt completion after close cannot revive messages or connection',async()=>{let resolve;const f=fixture({client:{sendMessage:()=>new Promise(r=>resolve=r)}});await f.connection.configure({});await f.connection.connect();const flight=f.connection.send('hello');await new Promise(r=>setImmediate(r));await f.connection.close();resolve({completion:'complete',text:'late'});await flight;assert.equal(f.connection.getState().sendOutcome,'unknown');assert.equal(f.connection.getState().connected,false);assert.equal(f.record().pendingSend,true);});
test('重启按账号和专用工作区恢复自己的聊天，不新建替代会话',async()=>{
 let saved=null,loaded=0;const conversationStore={read:()=>saved,write:v=>saved=JSON.parse(JSON.stringify(v))};
 const pair={accountKey:'a'.repeat(64),workspaceDir:'/synthetic/own'};
 const first=fixture({conversationStore});await first.connection.configure(pair);await first.connection.connect();await first.connection.send('hello');await first.connection.close();
 const next=fixture({conversationStore,client:{loadSession:async({sessionId})=>{loaded++;assert.equal(sessionId,'owned');return{sessionId};},createSession:async()=>assert.fail('must load owned session')}});
 await next.connection.configure(pair);assert.equal(next.connection.getState().messages[1].text,'reply');await next.connection.connect();assert.equal(loaded,1);await next.connection.close();
 const other=fixture({conversationStore});await other.connection.configure({...pair,accountKey:'b'.repeat(64)});assert.equal(other.connection.getState().messages.length,0);await other.connection.close();
});

test('专用实时任务根据实际prompt和delta推进，历史pending不能覆盖终态',async()=>{
 let finish;const changed=[];const f=fixture({onTaskChange:t=>changed.push(t),client:{sendMessage:()=>new Promise(r=>finish=r),listTasks:async()=>({tasks:[{id:'old',state:'pending'}]})}});
 await f.connection.configure({});await f.connection.connect();const p=f.connection.send('only own prompt');await new Promise(r=>setImmediate(r));
 assert.equal(f.connection.getState().liveTask.phase,'starting');assert.equal(f.connection.getState().liveTask.running,true);
 f.clientOptions().onEvent({type:'delta',sessionId:'owned',text:'reply'});assert.equal(f.connection.getState().liveTask.phase,'running');
 finish({completion:'complete',text:'reply'});await p;await f.connection.refresh();
 assert.equal(f.connection.getState().liveTask.state,'completed');assert.equal(f.connection.getState().tasks[0].state,'pending');assert.equal(changed.filter(t=>t.state==='completed').length,1);await f.connection.close();
});
test('取消请求不抢先报中断，只有prompt确认cancelled后才进入终态',async()=>{
 let finish;const f=fixture({client:{sendMessage:()=>new Promise(r=>finish=r),cancel:async()=>({requested:true})}});
 await f.connection.configure({});await f.connection.connect();const p=f.connection.send('own');await new Promise(r=>setImmediate(r));await f.connection.cancel();
 assert.equal(f.connection.getState().liveTask.phase,'cancelling');assert.equal(f.connection.getState().liveTask.running,true);
 finish({completion:'cancelled',text:''});await p;assert.equal(f.connection.getState().liveTask.state,'interrupted');await f.connection.close();
});
test('掉线断开使运行任务未知，迟到完成不触发成功和重复发送',async()=>{
 let finish;const changed=[];const f=fixture({onTaskChange:t=>changed.push(t),client:{sendMessage:()=>new Promise(r=>finish=r)}});
 await f.connection.configure({});await f.connection.connect();const p=f.connection.send('own');await new Promise(r=>setImmediate(r));await f.connection.disconnect();
 assert.equal(f.connection.getState().liveTask.state,'unknown');assert.equal(f.connection.getState().liveTask.running,null);assert.equal(f.connection.getState().sendOutcome,'unknown');
 finish({completion:'complete',text:'late'});await p;assert.equal(changed.some(t=>t.state==='completed'),false);await f.connection.close();
});
test('明确RPC失败和网络结果未知分别报告，恢复pending不产生新任务开始',async()=>{
 for(const[code,expected]of[['RPC_ERROR','failed'],['UNKNOWN_OUTCOME','unknown'],['TIMEOUT','unknown']]){
  const f=fixture({client:{sendMessage:async()=>{throw Object.assign(Error(),{code});}}});await f.connection.configure({});await f.connection.connect();await f.connection.send('own');assert.equal(f.connection.getState().liveTask.state,expected);await f.connection.close();
 }
 const changed=[];const f=fixture({onTaskChange:t=>changed.push(t),store:{read:()=>({pendingSend:true,requestId:'previous',createdAt:1}),write(){}}});assert.equal(f.connection.getState().liveTask.state,'unknown');assert.equal(changed.length,0);await f.connection.close();
});
