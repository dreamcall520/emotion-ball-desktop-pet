const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {createCodexChatRpc,DISABLED_FEATURES}=require('../lib/codex-chat-rpc');
const {createNotesOrganizer,notesOrganizerMessage}=require('../lib/notes-organizer');
const WORKSPACE='/private/qiuqiu-notes';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({raw='{"title":"出行计划","body":"10月3日给张三转账100元。"}',autoComplete=true,timeoutMs=2000,account=true,hold}={}){
  const packets=[],launches=[],mkdirs=[],callbacks=[];
  const organizer=createNotesOrganizer({workspaceDir:WORKSPACE,timeoutMs,fsImpl:{mkdirSync:(...args)=>mkdirs.push(args)},createRpc:options=>{
    callbacks.push(options);const child=new EventEmitter();child.pid=999999;child.kills=[];
    for(const key of ['stdin','stdout','stderr'])child[key]=new PassThrough();
    child.kill=signal=>{child.kills.push(signal);queueMicrotask(()=>child.emit('exit',1));return true};child.stdin.on('finish',()=>queueMicrotask(()=>child.emit('exit',0)));
    const send=value=>child.stdout.write(JSON.stringify(value)+'\n'),index=launches.length+1,threadId=`thread_${index}`,turnId=`turn_${index}`;
    child.stdin.on('data',chunk=>{const p=JSON.parse(chunk);packets.push(p);if(!p.id||p.error)return;if(hold===p.method)return;
      let result={};
      if(p.method==='config/read')result={config:{features:Object.fromEntries(DISABLED_FEATURES.map(key=>[key,false])),web_search:'disabled',project_doc_max_bytes:0,mcp_servers:{}}};
      if(p.method==='account/read')result={account:account?{type:'chatgpt',email:'notes@example.test'}:null};
      if(p.method==='model/list')result={data:['gpt-6-sol','gpt-6-luna'].map(id=>({id,model:id,displayName:id,description:'文字模型',hidden:false,isDefault:false,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]}))};
      if(p.method==='thread/start')result={thread:{id:threadId,environments:[],turns:[],status:{type:'idle'}},cwd:WORKSPACE,approvalPolicy:'never',sandbox:{type:'readOnly',networkAccess:false},instructionSources:[]};
      if(p.method==='turn/start'){
        result={turn:{id:turnId,status:'inProgress'}};
        if(autoComplete)queueMicrotask(()=>{send({method:'turn/started',params:{threadId,turn:{id:turnId,status:'inProgress'}}});send({method:'item/completed',params:{threadId,turnId,item:{id:'reply',type:'agentMessage',phase:'final_answer',text:raw}}});send({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}})});
      }
      queueMicrotask(()=>send({id:p.id,result}));
    });
    return createCodexChatRpc({...options,env:{},homedir:()=>'/private/notes-user',timeoutMs:500,
      fs:{promises:{lstat:async()=>({isFile:()=>true,isSymbolicLink:()=>false}),access:async()=>{}}},spawn:(...args)=>{launches.push({args,child,send,threadId,turnId});return child}});
  }});
  return {organizer,packets,launches,mkdirs,callbacks};
}
const source={title:'出行计划',body:'10月3日 给张三转账100元。'};

test('organizer仅用户调用后连接，每次独立ephemeral并用目录内轻量模型，结果不写原文',async()=>{
  const h=harness();assert.equal(h.launches.length,0);assert.equal(h.mkdirs.length,0);
  const first=await h.organizer.organize(source);assert.deepEqual(first,{title:'出行计划',body:'10月3日给张三转账100元。'});assert.equal(source.body,'10月3日 给张三转账100元。');
  await h.organizer.organize(source);await h.organizer.close();assert.equal(h.launches.length,2);
  assert.ok(h.packets.filter(p=>p.method==='thread/start').every(p=>p.params.ephemeral===true));
  for(const p of h.packets.filter(p=>p.method==='turn/start')){assert.equal(p.params.model,'gpt-6-luna');assert.equal(p.params.effort,'low');assert.deepEqual(JSON.parse(p.params.input[0].text),source);assert.deepEqual(p.params.environments,[])}
  assert.equal(h.packets.some(p=>p.method==='thread/resume'),false);
});

test('完整20,000字正文与200字标题往返，无切片',async()=>{
  const input={title:'标'.repeat(200),body:'😀'.repeat(20000)},h=harness({raw:JSON.stringify(input)});
  assert.deepEqual(await h.organizer.organize(input),input);await h.organizer.close();assert.deepEqual(JSON.parse(h.packets.find(p=>p.method==='turn/start').params.input[0].text),input);
});

test('输入与响应严格验证，非法/超长/额外字段/代码围栏均不替换且无原始错误泄露',async()=>{
  const invalidInputs=[{title:'',body:''},{title:'a'.repeat(201),body:'文字'},{title:'',body:'字'.repeat(20001)},{...source,token:'SECRET'},{title:'',body:'\0'}];
  const h=harness();for(const input of invalidInputs)await assert.rejects(h.organizer.organize(input),{code:'INVALID_INPUT'});assert.equal(h.launches.length,0);await h.organizer.close();
  for(const raw of ['not json','{}',JSON.stringify({...source,action:'hop'}),JSON.stringify({title:'',body:''}),JSON.stringify({title:'a'.repeat(201),body:'x'}),JSON.stringify({title:'',body:'字'.repeat(20001)}),JSON.stringify({title:'',body:'```\nSECRET\n```'})]){
    const failed=harness({raw});await assert.rejects(failed.organizer.organize(source),error=>error.code==='INVALID_RESPONSE'&&!error.message.includes('SECRET'));await failed.organizer.close();
  }
});

test('busy与取消/晚到结果隔离，取消只关闭自己的临时进程，随后可再整理',async()=>{
  const h=harness({autoComplete:false});const answer=h.organizer.organize(source),rejected=assert.rejects(answer,{code:'CANCELLED'});await tick();
  await assert.rejects(h.organizer.organize(source),{code:'BUSY'});await h.organizer.cancel();await rejected;
  h.callbacks[0].onNotification({method:'item/completed',params:{threadId:'thread_1',turnId:'turn_1',item:{type:'agentMessage',phase:'final_answer',text:JSON.stringify(source)}}});h.callbacks[0].onNotification({method:'turn/completed',params:{threadId:'thread_1',turn:{id:'turn_1',status:'completed'}}});
  const second=h.organizer.organize(source),secondRejected=assert.rejects(second,{code:'CANCELLED'});await tick();assert.equal(h.launches.length,2);await h.organizer.cancel();await secondRejected;await h.organizer.close();
});

test('超时不重发；未登录不建线程；close终止pending并禁止再发',async()=>{
  const timed=harness({autoComplete:false,timeoutMs:10});await assert.rejects(timed.organizer.organize(source),{code:'TIMEOUT'});await timed.organizer.close();assert.equal(timed.packets.filter(p=>p.method==='turn/start').length,1);
  const loggedOut=harness({account:false});await assert.rejects(loggedOut.organizer.organize(source),{code:'UNAUTHENTICATED'});assert.equal(loggedOut.packets.some(p=>p.method==='thread/start'),false);await loggedOut.organizer.close();
  const closed=harness({hold:'config/read'}),answer=closed.organizer.organize(source),rejected=assert.rejects(answer,{code:'CLOSED'});await tick();await closed.organizer.close();await rejected;await assert.rejects(closed.organizer.organize(source),{code:'CLOSED'});
  assert.equal(notesOrganizerMessage(new Error('SECRET')), '整理连接中断，原文未替换，请重试。');
  assert.equal(notesOrganizerMessage({code:'constructor',message:'SECRET'}), '整理连接中断，原文未替换，请重试。');
});
