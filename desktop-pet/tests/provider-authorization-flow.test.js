const test=require('node:test'),assert=require('node:assert/strict');
const {createFlow}=require('../lib/provider-authorization-flow');
const guide=(state,p)=>({steps:state[p]||[]});
const auth=id=>({id,status:'needs-authorization',action:'enable-provider'});
test('selected tools alone run in stable serial order, ready and optional steps never authorize',()=>{
 const f=createFlow(guide);f.start(['workbuddy','codex','evil']);const state={codex:[{id:'ready',status:'ready'},auth('chat')],zcode:[auth('chat')],workbuddy:[{...auth('quota'),optional:true},auth('tasks')]};
 let n=f.next(state);assert.equal(n.provider,'codex');f.attempted(n.provider,n.step);n=f.next(state);assert.equal(n.provider,'workbuddy');assert.equal(n.step.id,'tasks');f.attempted(n.provider,n.step);assert.equal(f.next(state),null);assert.equal(f.active,false);
});
test('pending user confirmation pauses serial queue and stopping prevents late state from starting another authorization',()=>{
 const f=createFlow(guide);f.start(['codex','zcode']);assert.deepEqual(f.next({codex:[{id:'chat',status:'working'}],zcode:[auth('chat')]}),{provider:'codex',waiting:true});f.stop();assert.equal(f.next({zcode:[auth('chat')]}),null);
});
test('cancelled provider defers its remaining steps while other selected tool may continue; no retry loop',()=>{
 const f=createFlow(guide);const s={codex:[auth('chat'),auth('data')],zcode:[auth('chat')]};f.start(['codex','zcode']);const n=f.next(s);f.attempted(n.provider,n.step);f.defer('codex');assert.equal(f.next(s).provider,'zcode');f.defer('zcode');assert.equal(f.next(s),null);
});
test('unsupported, empty and waiting for first event never trigger automatic action',()=>{
 const f=createFlow(guide);f.start(['zcode']);assert.equal(f.next({zcode:[{id:'chat',status:'unavailable',action:'enable-provider'},{id:'tasks',status:'ready'},{id:'task-verification',status:'unknown'}]}),null);
});

test('optional quota refresh and informational reads cannot block required task authorization',()=>{const f=createFlow(guide);f.start(['workbuddy']);const n=f.next({workbuddy:[{id:'quota',status:'working',optional:true},{id:'read',status:'working',informational:true},auth('tasks')]});assert.equal(n.step.id,'tasks');});


test('OAuth已启动且等待本人时不弹下一家登录，完成后才继续且stop阻止迟到续接',()=>{
 const {buildProviderGuide}=require('../lib/provider-connection-guide');const f=createFlow(buildProviderGuide);
 const state={codex:{directory:'stored'},workbuddyDesktop:{directory:'stored'},onboarding:{codex:{status:'partial',chat:{status:'needs-login',loginPending:false}},workbuddy:{status:'idle',chat:{status:'needs-login',loginPending:false}}}};
 f.start(['codex','workbuddy']);let n=f.next(state);assert.equal(n.provider,'codex');assert.equal(n.step.id,'chat');f.attempted(n.provider,n.step);
 state.onboarding.codex.chat.loginPending=true;assert.deepEqual(f.next(state),{provider:'codex',waiting:true});assert.deepEqual(f.next(state),{provider:'codex',waiting:true});
 state.onboarding.codex.chat={status:'ready'};n=f.next(state);assert.equal(n.provider,'workbuddy');assert.equal(n.step.id,'chat');f.stop();state.onboarding.workbuddy.chat={status:'needs-login',loginPending:true};assert.equal(f.next(state),null);
});


test('OAuth失败后的实时false不会卡住队列，也不在同轮重开已经尝试的登录',()=>{
 const {buildProviderGuide}=require('../lib/provider-connection-guide');const f=createFlow(buildProviderGuide);
 const state={codex:{directory:'stored'},workbuddyDesktop:{directory:'stored'},providerLoginPending:{codex:false},onboarding:{codex:{chat:{status:'needs-login',loginPending:false}},workbuddy:{chat:{status:'needs-login',loginPending:false}}}};
 f.start(['codex','workbuddy']);let n=f.next(state);f.attempted(n.provider,n.step);state.onboarding.codex.chat.loginPending=true;state.providerLoginPending.codex=true;assert.equal(f.next(state).waiting,true);
 state.providerLoginPending.codex=false;n=f.next(state);assert.equal(n.provider,'workbuddy');assert.equal(n.step.id,'chat');
});

test('聊天批量不触发目录/插件；数据批量即使未登录也不启动聊天授权',()=>{
 const {buildProviderGuide}=require('../lib/provider-connection-guide');const state={onboarding:{codex:{chat:{status:'needs-login'},data:{status:'needs-authorization'}},workbuddy:{chat:{status:'needs-login'},data:{status:'needs-authorization'}}},codex:{directory:'missing'},workbuddyDesktop:{directory:'missing'}};
 for(const capability of ['chat','data']){
  const f=createFlow((s,p)=>buildProviderGuide(s,p,{capability}));f.start(['codex','workbuddy']);let next;const actions=[];
  while(next=f.next(state)){assert.equal(next.waiting,undefined);actions.push(next.step.action);assert.equal(next.step.payload.capability,capability);f.attempted(next.provider,next.step);}
  if(capability==='chat')assert.deepEqual(actions,['enable-provider','enable-provider']);else assert.equal(actions.includes('enable-provider'),false);
 }
});
