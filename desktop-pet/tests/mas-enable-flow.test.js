const test=require('node:test');const assert=require('node:assert/strict');
const {createMasEnableFlow}=require('../lib/mas-enable-flow');
const flush=()=>new Promise(r=>setImmediate(r));
function fixture(overrides={}){const calls=[];const flow=createMasEnableFlow({ensureDirectory:async(p,o)=>{calls.push(['grant',p,o.interactive]);return{status:'stored'};},refreshData:async()=>({available:true,message:'数据可用'}),connectChat:async()=>({status:'ready',message:'聊天可用'}),revoke:async p=>calls.push(['revoke',p]),...overrides});return{flow,calls};}
test('聊天启用直接连接官方登录，不弹目录授权，缺原工具也可ready',async()=>{const{flow,calls}=fixture({ensureDirectory:async(p,o)=>{calls.push(['grant',p,o.interactive]);return{status:'needs-authorization'};}});await flow.enable('codex');await flush();assert.deepEqual(calls,[['grant','codex',false]]);assert.equal(flow.getState().codex.status,'ready');assert.equal(flow.getState().codex.data.status,'needs-authorization');});
test('额度查询缓慢不会阻塞聊天或将可用聊天显示为部分失败',async()=>{let finish;const{flow}=fixture({refreshData:()=>new Promise(r=>finish=r)});await flow.enable('codex');assert.equal(flow.getState().codex.chat.status,'ready');assert.equal(flow.getState().codex.status,'ready');await flush();assert.equal(flow.getState().codex.data.status,'working');finish({available:false,message:'积分可选授权'});await flush();assert.equal(flow.getState().codex.status,'ready');assert.equal(flow.getState().codex.data.status,'unavailable');});
test('明确连接原工具数据才打开系统授权，取消不影响已连接聊天',async()=>{let reads=0,chat=0;const{flow,calls}=fixture({ensureDirectory:async(p,o)=>{calls.push(o.interactive);return{status:o.interactive?'cancelled':'needs-authorization'};},refreshData:async()=>reads++,connectChat:async()=>{chat++;return{status:'ready'};}});await flow.enable('workbuddy');await flush();await flow.enableData('workbuddy');assert.deepEqual(calls,[false,true]);assert.equal(reads,0);assert.equal(chat,1);assert.equal(flow.getState().workbuddy.status,'ready');assert.equal(flow.getState().workbuddy.data.status,'cancelled');});
test('数据授权只连接数据，不强制重新登录聊天',async()=>{let chat=0;const{flow,calls}=fixture({connectChat:async()=>chat++});await flow.enableData('zcode');assert.equal(chat,0);assert.deepEqual(calls,[['grant','zcode',true]]);assert.equal(flow.getState().zcode.data.status,'ready');assert.notEqual(flow.getState().zcode.chat.status,'ready');});
test('聊天受阻保留具体原因，不把数据成功当作聊天成功',async()=>{const{flow}=fixture({connectChat:async()=>({status:'needs-data-authorization',message:'读取已有模型配置后连接'})});await flow.enable('zcode');await flush();assert.equal(flow.getState().zcode.status,'partial');assert.equal(flow.getState().zcode.chat.status,'needs-data-authorization');assert.equal(flow.getState().zcode.data.status,'ready');});
test('重复启用复用单次聊天登录，不同工具串行处理交互',async()=>{let finish;const{flow}=fixture({connectChat:()=>new Promise(r=>finish=r)});const first=flow.enable('codex'),second=flow.enable('codex');assert.equal(first,second);await assert.rejects(flow.enable('zcode'),{code:'BUSY'});await Promise.resolve();finish({status:'ready'});await first;await flush();});
test('重启恢复不弹目录或发起新登录，先恢复聊天再检查已有数据',async()=>{const seen=[];const{flow}=fixture({connectChat:async(p,o)=>{seen.push(['chat',o.interactive]);return{status:'needs-login'};},ensureDirectory:async(p,o)=>{seen.push(['data',o.interactive]);return{status:'needs-authorization'};}});await flow.restore('codex');await flush();assert.deepEqual(seen,[['chat',false],['data',false]]);assert.equal(flow.getState().codex.chat.status,'needs-login');});
test('关闭后迟到聊天和数据都不能恢复状态',async()=>{let finish;const{flow}=fixture({connectChat:()=>new Promise(r=>finish=r)});const p=flow.enable('codex');await Promise.resolve();flow.close();finish({status:'ready'});await p;assert.notEqual(flow.getState().codex.status,'ready');});
test('撤销期间阻止其他工具启用，晚到数据不能复活授权',async()=>{let finishData,finishRevoke;const{flow}=fixture({refreshData:()=>new Promise(r=>finishData=r),revoke:()=>new Promise(r=>finishRevoke=r)});await flow.enable('codex');await flush();const pending=flow.disable('codex');await Promise.resolve();assert.equal(flow.getState().codex.step,'revoking');await assert.rejects(flow.enable('zcode'),{code:'BUSY'});finishData({available:true,message:'旧请求'});finishRevoke();await pending;await flush();assert.equal(flow.getState().codex.status,'idle');assert.equal(flow.getState().codex.data.status,'needs-authorization');});
test('退出期间排队的数据授权不能再弹系统选择器',async()=>{
 let finish;const seen=[];const{flow}=fixture({ensureDirectory:async(p,o)=>{seen.push(o.interactive);await new Promise(r=>finish=r);return{status:'stored'};}});await flow.enable('codex');await flush();const requested=flow.enableData('codex');flow.close();finish();await requested;assert.deepEqual(seen,[false]);
});
test('停止联动失败可重试，不遗留正在撤销状态',async()=>{
 let failing=true;const{flow}=fixture({revoke:async()=>{if(failing)throw Error('synthetic failure');}});await assert.rejects(flow.disable('codex'));assert.equal(flow.getState().codex.status,'error');failing=false;await flow.disable('codex');assert.equal(flow.getState().codex.status,'idle');
});
test('来源和启用偏好只在取得独占连接后修改，占用失败不执行准备',async()=>{let finish,changed=0;const{flow}=fixture({connectChat:()=>new Promise(r=>finish=r)});const pending=flow.enable('codex',{interactive:false});await Promise.resolve();await assert.rejects(flow.enable('zcode',{beforeConnect:async()=>changed++}),{code:'BUSY'});await assert.rejects(flow.enable('codex',{beforeConnect:async()=>changed++}),{code:'BUSY'});assert.equal(changed,0);finish({status:'ready'});await pending;let observed=false;const f=fixture({connectChat:async()=>{assert.equal(observed,true);return{status:'ready'};}});await f.flow.enable('zcode',{beforeConnect:async()=>{observed=true;}});assert.equal(f.flow.getState().zcode.chat.status,'ready');});


test('仅允许读取空工具目录不会把未登录聊天误判为厂商不支持，仍能启用聊天',async()=>{
 const {flow}=fixture();assert.equal(flow.getState().codex.chat.status,'needs-login');assert.equal(flow.getState().codex.chat.loginPending,false);
 await flow.enableData('codex');const state=flow.getState();assert.equal(state.codex.status,'partial');assert.equal(state.codex.chat.status,'needs-login');
 const {buildProviderGuide}=require('../lib/provider-connection-guide');const guide=buildProviderGuide({codex:{directory:'stored'},onboarding:state},'codex');assert.equal(guide.nextStepId,'chat');assert.equal(guide.steps.find(x=>x.id==='chat').action,'enable-provider');
 await flow.enable('codex');assert.equal(flow.getState().codex.chat.status,'ready');
});
test('活跃OAuth等待保留明确标记，恢复时尚未发起登录不冒充等待中',async()=>{
 const {flow}=fixture({connectChat:async(p,{interactive})=>({status:'needs-login',loginPending:interactive,message:interactive?'请本人完成登录':'尚未登录'})});
 await flow.restore('codex');assert.equal(flow.getState().codex.chat.loginPending,false);await flow.enable('codex');assert.equal(flow.getState().codex.chat.loginPending,true);
});

test('只聊天不读取已授权额度或任务，模型目录用途不会伪装成数据连接',async()=>{
 const seen=[];let queries=0;const {flow}=fixture({ensureDirectory:async(p,o)=>{seen.push([p,o]);return{status:'stored'};},refreshData:async()=>{queries++;return{available:true};}});
 await flow.enable('zcode',{restoreData:false});await flush();assert.equal(seen.length,0);assert.equal(queries,0);
 const result=await flow.enableModelDirectory('zcode');assert.equal(result.status,'stored');assert.deepEqual(seen,[['zcode',{interactive:true,purpose:'chat-model-config'}]]);assert.equal(queries,0);assert.equal(flow.getState().zcode.data.status,'needs-authorization');
 await flow.enable('zcode',{restoreData:false});await flush();assert.equal(queries,0);
});
test('模型目录取消或关闭不会启动额度查询或改变数据状态',async()=>{
 let release;const {flow}=fixture({ensureDirectory:()=>new Promise(r=>release=r),refreshData:()=>{throw Error('must not run');}});
 const pending=flow.enableModelDirectory('zcode');await Promise.resolve();await assert.rejects(flow.enable('codex'),{code:'BUSY'});flow.close();release({status:'stored'});assert.deepEqual(await pending,{status:'cancelled'});assert.equal(flow.getState().zcode.data.status,'needs-authorization');
});

test('重启只聊天用户不会因为已有模型目录而升级成额度任务，原已启用数据仍恢复',async()=>{
 const seen=[];let allowed=false;const {flow}=fixture({canRestoreData:()=>allowed,ensureDirectory:async(p,o)=>{seen.push(o.interactive);return{status:'stored'};}});
 await flow.restore('zcode');await flush();assert.deepEqual(seen,[]);allowed=true;await flow.restore('zcode');await flush();assert.deepEqual(seen,[false]);
});
