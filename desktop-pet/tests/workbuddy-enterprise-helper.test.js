const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execute,sessionIdentity,enterpriseQuotaReport}=require('../lib/workbuddy-helper.cjs');
const {readWorkBuddyUsage}=require('../lib/workbuddy-usage-reader');
const personal={account:{type:'personal',uid:'fixture-user'},auth:{domain:'www.workbuddy.cn'}};
const session=(enterpriseId='enterprise-a',extra={})=>({account:{type:'ultimate',uid:'fixture-user',enterpriseId,...extra},auth:{domain:'www.workbuddy.cn'}});
const auth=(value=session())=>({...sessionIdentity(value),token:'fixture-enterprise-token-not-real'});
const response=value=>new Response(JSON.stringify({code:0,data:value}),{headers:{'Content-Type':'application/json'}});
function withFetch(t,fn){const previous=global.fetch;global.fetch=(url,options)=>{new Headers(options?.headers);return fn(url,options);};t.after(()=>{global.fetch=previous;});}
test('personal legacy scope is identical; enterprise/department/type/domain scopes cannot alias',()=>{
 const expected=crypto.createHash('sha256').update('workbuddy:www.workbuddy.cn:personal:fixture-user').digest('hex');assert.equal(sessionIdentity(personal).accountKey,expected);
 const a=auth();assert.notEqual(a.accountKey,expected);assert.notEqual(a.accountKey,auth(session('enterprise-b')).accountKey);assert.notEqual(a.accountKey,auth(session('enterprise-a',{departmentId:'department-b'})).accountKey);
 for(const domain of ['www.workbuddy.cn','www.codebuddy.cn','copilot.tencent.com'])assert.equal(sessionIdentity({...session(),auth:{domain}}).scope,'enterprise');
 for(const bad of [{...session(),auth:{domain:'www.codebuddy.ai'}},{...session(),deploymentType:'Self-Hosted'},{...session(),networkEnvironment:'cloudhosted'},{...session(),auth:{domain:'company.sso.codebuddy.cn'}},session('enterprise-a',{type:'exclusive'}),session('bad\r\nheader')])assert.throws(()=>sessionIdentity(bad),{code:'UNSUPPORTED_ACCOUNT'});
 assert.throws(()=>sessionIdentity({...personal,account:{...personal.account,isCurrentOneIdEnterprise:true}}),{code:'UNSUPPORTED_ACCOUNT'});
});
test('enterprise credits preserve finite used/limit and unlimited without fake personal breakdown',()=>{
 const finite=enterpriseQuotaReport({limitNum:10000,credit:2401.99,cycleResetTime:'2026-11-01 00:00:00'},123);assert.equal(finite.total,7598.01);assert.equal(finite.limit,10000);assert.equal(finite.used,2401.99);assert.equal(finite.nextRefreshAt,Date.parse('2026-11-01T00:00:00+08:00'));assert.equal(finite.scope,'enterprise');assert.equal(finite.unlimited,false);assert.deepEqual([finite.basic,finite.reward,finite.purchased],[null,null,null]);
 const infinite=enterpriseQuotaReport({limitNum:-1,credit:12},123);assert.equal(infinite.unlimited,true);assert.equal(infinite.total,null);assert.equal(infinite.limit,null);assert.equal(infinite.used,12);assert.equal(infinite.nextRefreshAt,null);
 for(const value of [{limitNum:10},{limitNum:-2,credit:0},{limitNum:10,credit:-1},{limitNum:Infinity,credit:0},{limitNum:10,credit:0,cycleResetTime:'broken'},{limit_num:10,used_num:0}])assert.throws(()=>enterpriseQuotaReport(value),{code:'INVALID_RESPONSE'});
});
test('enterprise quota uses official desktop v2 and tenant headers without personal resource calls',async t=>{
 const a=auth(session('enterprise-a',{departmentFullName:'department-name'}));const calls=[];withFetch(t,async(url,options)=>{calls.push({url,options});return response({limitNum:100,credit:20});});
 const result=await execute('quota',{},()=>{},{authReader:()=>({...a})});assert.equal(result.report.total,80);assert.equal(calls.length,1);assert.equal(calls[0].url,'https://www.workbuddy.cn/v2/billing/meter/get-enterprise-user-usage');assert.equal(calls[0].options.body,'{}');
 assert.equal(calls[0].options.headers['X-Enterprise-Id'],'enterprise-a');assert.equal(calls[0].options.headers['X-Tenant-Id'],'enterprise-a');assert.equal(calls[0].options.headers['X-Department-Info'],undefined);assert.equal(calls[0].options.headers.Authorization,'Bearer '+a.token);assert.equal(calls[0].options.headers['X-Product'],'SaaS');
});
test('enterprise model and chat share selected tenant and cannot submit disabled models',async t=>{
 const a=auth(),calls=[];withFetch(t,async(url,options)=>{calls.push({url,options});if(url.endsWith('/v3/config'))return response({agents:[{name:'cli',models:['allowed','blocked']}],models:[{id:'allowed',name:'Allowed'},{id:'blocked',name:'Blocked',disabled:true},{id:'other-agent',name:'Other'}]});return new Response('data: {"choices":[{"delta":{"content":"fixture answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});});
 const options={authReader:()=>({...a})},directory=await execute('models',{},()=>{},options);assert.deepEqual(directory.models,[{id:'allowed',displayName:'Allowed'}]);
 await assert.rejects(execute('chat',{expectedAccountKey:a.accountKey,model:'blocked',conversationId:'fixture-chat',messages:[{role:'user',content:'fixture text'}]},()=>{},options),{code:'MODEL_UNAVAILABLE'});assert.equal(calls.filter(c=>c.url.includes('/chat/')).length,0);
 const deltas=[],result=await execute('chat',{expectedAccountKey:a.accountKey,model:'allowed',conversationId:'fixture-chat',messages:[{role:'user',content:'fixture text'}]},text=>deltas.push(text),options);assert.equal(result.text,'fixture answer');assert.deepEqual(deltas,['fixture answer']);assert(calls.every(c=>c.options.headers['X-Enterprise-Id']==='enterprise-a'&&c.options.headers['X-Tenant-Id']==='enterprise-a'));
});
test('a scope change during network or stream cannot publish enterprise data or deltas',async t=>{
 const a=auth(),b=auth(session('enterprise-b'));let current=a;withFetch(t,async()=>{current=b;return response({limitNum:100,credit:20});});await assert.rejects(execute('quota',{},()=>{},{authReader:()=>({...current})}),{code:'ACCOUNT_CHANGED'});
 current=a;global.fetch=async url=>url.endsWith('/v3/config')?response({agents:[{name:'cli',models:['allowed']}],models:[{id:'allowed',name:'Allowed'}]}):{ok:true,headers:new Headers({'Content-Type':'text/event-stream'}),body:(async function*(){current=b;yield Buffer.from('data: {"choices":[{"delta":{"content":"old tenant"}}]}\n\ndata: [DONE]\n\n');})()};
 const deltas=[];await assert.rejects(execute('chat',{expectedAccountKey:a.accountKey,model:'allowed',conversationId:'fixture-chat',messages:[{role:'user',content:'fixture text'}]},delta=>deltas.push(delta),{authReader:()=>({...current})}),{code:'ACCOUNT_CHANGED'});assert.deepEqual(deltas,[],'old tenant stream never reaches the UI');
});
test('enterprise history and uid-only tasks never touch the personal website/cache',async t=>{
 const a=auth();let calls=0;withFetch(t,async()=>{calls++;throw Error('must not request personal history');});
 await assert.rejects(readWorkBuddyUsage({auth:a,fetchImpl:global.fetch}),{code:'USAGE_UNAVAILABLE'});
 for(const operation of ['tasks','task-open'])await assert.rejects(execute(operation,{expectedAccountKey:a.accountKey},()=>{},{authReader:()=>({...a})}),{code:'TASK_CACHE_UNSUPPORTED'});
 await assert.rejects(execute('usage',{},()=>{},{authReader:()=>({...a})}),{code:'USAGE_UNAVAILABLE'});assert.equal(calls,0);
});


test('all-disabled enterprise config is an unavailable model state rather than permission bypass',async t=>{
 const a=auth();withFetch(t,async()=>response({agents:[{name:'cli',models:['blocked']}],models:[{id:'blocked',name:'Blocked',disabled:true}]}));await assert.rejects(execute('models',{},()=>{},{authReader:()=>({...a})}),{code:'MODEL_UNAVAILABLE'});
});


test('Chinese and encrypted department authority stays scoped and never enters optional ByteString headers',async t=>{
 const plain=session('enterprise-a',{departmentFullName:'研发中心/智能产品部'}),opaque=session('enterprise-a',{departmentFullName:{$wbEncrypted:1,envelope:Buffer.from('fixture-encrypted-envelope-not-a-real-secret').toString('base64')}});
 assert.notEqual(auth(plain).accountKey,auth(session('enterprise-a',{departmentFullName:'销售中心'})).accountKey);
 assert.notEqual(auth(opaque).accountKey,auth(plain).accountKey);let requests=0;withFetch(t,async(_url,options)=>{assert.doesNotThrow(()=>new Headers(options.headers));assert.equal(options.headers['X-Department-Info'],undefined);requests++;return response({limitNum:100,credit:20});});
 for(const value of [plain,opaque]){const a=auth(value);assert.equal((await execute('quota',{},()=>{},{authReader:()=>({...a})})).report.total,80);}assert.equal(requests,2);
});
