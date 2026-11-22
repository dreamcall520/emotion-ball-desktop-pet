const test=require('node:test'),assert=require('node:assert/strict');
const {projectManagedCodexQuota:project,readManagedCodexQuota:read}=require('../lib/managed-codex-quota-reader');
test('额度安全投影只保留计费桶窗口及数值余额，缺值不补零，拒绝非法结构',()=>{
 const value=project({rateLimitsByLimitId:{codex:{primary:{usedPercent:101,windowDurationMins:-1,resetsAt:-1},credits:{hasCredits:'true',balance:'SECRET',unlimited:null},email:'SECRET'},spark:{limitId:'other',primary:{usedPercent:5}},'user@example.test':{primary:{usedPercent:4}}}},100);
 assert.deepEqual(value.windows[0],{id:'codex:primary',windowMinutes:null,usedPercent:null,resetsAt:null});assert.deepEqual(value.credits,{hasCredits:null,unlimited:null,balance:null});assert.equal(value.scopes.length,1);assert.equal(JSON.stringify(value).includes('SECRET'),false);
 for(const raw of [null,[],{rateLimitsByLimitId:'SECRET'}])assert.throws(()=>project(raw,100),{code:'INVALID_FRAME'});assert.throws(()=>project({},NaN),{code:'INVALID_FRAME'});
 const zero=project({rateLimits:{primary:{usedPercent:0,windowDurationMins:300,resetsAt:2000000000},credits:{hasCredits:false,unlimited:false,balance:'0'}}});assert.equal(zero.windows[0].usedPercent,0);assert.equal(zero.credits.balance,'0');
});
test('官方Codex余额与重置机会沿同一次额度响应投影，保留零/未知和秒时间边界',()=>{
 const raw={rateLimitsByLimitId:{codex:{primary:{usedPercent:100,windowDurationMins:10080,resetsAt:2000000000},credits:{hasCredits:true,unlimited:false,balance:'53489.1547310000',token:'SECRET'},spendControlReached:false},spark:{credits:{hasCredits:true,balance:'999999'}}},rateLimitResetCredits:{availableCount:3,credits:[
  {id:'a',title:'完全重置',status:'available',resetType:'codexRateLimits',grantedAt:1800000000,expiresAt:1801000000,email:'SECRET'},
  {id:'b',title:'完全重置',status:'available',resetType:'codexRateLimits',grantedAt:1800000100,expiresAt:null},
  {id:'c',title:'完全重置',status:'available',resetType:'codexRateLimits',grantedAt:1800000200,expiresAt:1802000000}
 ]}};
 const value=project(raw,123);assert.deepEqual(value.credits,{hasCredits:true,unlimited:false,balance:'53489.1547310000'});assert.equal(value.spendControlReached,false);assert.equal(value.resetCreditsAvailable,3);assert.equal(value.resetDetailsPartial,false);assert.equal(value.resetOpportunities.length,3);assert.equal(value.resetOpportunities[0].grantedAt,1800000000000);assert.equal(value.resetOpportunities[0].expiresAt,1801000000000);assert.equal(value.resetOpportunities[1].expiresAt,null);assert.equal(JSON.stringify(value).includes('SECRET'),false);
 const empty=project({rateLimits:raw.rateLimitsByLimitId.codex,rateLimitResetCredits:{availableCount:0,credits:[]}});assert.equal(empty.resetCreditsAvailable,0);assert.deepEqual(empty.resetOpportunities,[]);assert.equal(empty.resetDetailsPartial,false);
 const unknown=project({rateLimits:{primary:raw.rateLimitsByLimitId.codex.primary},rateLimitResetCredits:{availableCount:3}});assert.equal(unknown.resetCreditsAvailable,3);assert.equal(unknown.resetOpportunities,null);assert.equal(unknown.credits,undefined);
 const absent=project({rateLimitsByLimitId:{spark:raw.rateLimitsByLimitId.spark}});assert.equal(absent.credits,undefined);assert.equal(absent.resetCreditsAvailable,undefined);assert.equal(absent.resetOpportunities,undefined);
 raw.rateLimitResetCredits.credits.push({...raw.rateLimitResetCredits.credits[0]},{id:'unsafe',status:'available',grantedAt:'bad',expiresAt:1801000000});const partial=project(raw);assert.equal(partial.resetOpportunities.length,3);assert.equal(partial.resetDetailsPartial,true);
});
test('托管reader只启动自有RPC读取额度并关闭，无目录、登录或模型调用',async()=>{
 const calls=[],expected={source:'synthetic'};
 const result=await read({createRpc:async()=>({start:async()=>calls.push('start'),readRateLimits:async options=>{calls.push(['read',options]);return expected;},close:async()=>calls.push('close')}),now:()=>123});
 assert.equal(result,expected);assert.deepEqual(calls,['start',['read',{at:123}],'close']);
});
test('取消关闭自有RPC，迟到结果不能发布；初始化或额度错误只清理不回退',async()=>{
 const controller=new AbortController();let close=0,resolve,started;
 const ready=new Promise(done=>started=done);
 const pending=read({signal:controller.signal,createRpc:()=>({start:async()=>{},readRateLimits:()=>{started();return new Promise(done=>resolve=done);},close:async()=>{close++;}})});
 await ready;controller.abort();resolve({source:'stale'});await assert.rejects(pending,{code:'CANCELLED'});assert.ok(close>=1);
 for(const step of ['start','readRateLimits']){let closed=0;const error=Object.assign(new Error('safe'),{code:'UNAUTHENTICATED'});await assert.rejects(read({createRpc:()=>({start:async()=>{if(step==='start')throw error;},readRateLimits:async()=>{throw error;},close:async()=>closed++})}),value=>value===error);assert.equal(closed,1);}
 const aborted=new AbortController();aborted.abort();await assert.rejects(read({signal:aborted.signal,createRpc:()=>assert.fail('must not start')}),{code:'CANCELLED'});
});
