'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkBuddyWebUsage } = require('../lib/workbuddy-web-usage');
const now = Date.parse('2026-11-01T12:00:00+08:00');
const row = id => ({ requestId: String(id), requestTime: '2026-11-01 10:00:00', credit: '0.1', input: 'PRIVATE PROMPT', inputTrunc: 'SECRET' });
const response = (rows, total=rows.length) => new Response(JSON.stringify({code:0,data:{total,data:rows}}));
function reader(fetch, options={}) { return createWorkBuddyWebUsage({ session:{ fetch,getUserAgent:()=> 'OwnSession/1' },now:()=>now,...options}); }
test('own Session fixed endpoint, complete pages and metadata-only website projection',async()=>{
  const calls=[];
  const usage=reader(async(url,options)=>{calls.push({url,options});return calls.length===1?response(Array.from({length:100},(_,i)=>row(i)),101):response([row(100)],101);});
  const report=await usage.readUsage();
  assert.equal(calls.length,2);assert.equal(report.source,'website-usage');assert.equal(report.scope,'website-request-usage');
  assert.equal(report.requestCount,101);assert.equal(report.totalCredits,10.1);assert.equal(report.days.length,7);assert.equal(report.complete,true);
  assert.equal(report.todayRecords.length,1);assert.equal(report.delayHours,undefined);
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE|SECRET|input|requestId/);
  for(const [i,{url,options}] of calls.entries()){
    assert.equal(url,'https://www.workbuddy.cn/billing/meter/get-user-request-usage');assert.equal(options.credentials,'include');assert.equal(options.redirect,'manual');
    assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers.Authorization,undefined);
    assert.equal(JSON.parse(options.body).pageNum,i+1);assert.equal(JSON.parse(options.body).pageSize,100);
  }
});
test('valid empty complete usage is zero, not login failure',async()=>{
 const report=await reader(async()=>response([])).readUsage();assert.equal(report.totalCredits,0);assert.equal(report.requestCount,0);
});
test('incomplete or changing pagination never publishes partial report',async()=>{
 await assert.rejects(reader(async()=>response([row(1)],2)).readUsage(),{code:'USAGE_INCOMPLETE'});
 let count=0;await assert.rejects(reader(async()=>++count===1?response(Array.from({length:100},(_,i)=>row(i)),101):response([row(101)],102)).readUsage(),{code:'USAGE_INCOMPLETE'});
});
test('duplicate IDs, invalid dates and oversized totals reject',async()=>{
 for(const result of [response([row(1),row(1)]),response([{...row(1),requestTime:'2030-01-01 00:00:00'}]),response([],10001)])
 await assert.rejects(reader(async()=>result).readUsage(),{code:'INVALID_RESPONSE'});
});
test('login/redirect/status errors are safe and never launch a login',async()=>{
 for(const [status,code] of [[401,'LOGIN_REQUIRED'],[403,'LOGIN_REQUIRED'],[302,'REDIRECT_REJECTED'],[429,'RATE_LIMITED'],[503,'SERVICE_UNAVAILABLE']]){
  await assert.rejects(reader(async()=>new Response('PRIVATE',{status})).readUsage(),{code});
 }
 await assert.rejects(reader(async()=>{throw new Error('SECRET TOKEN');}).readUsage(),error=>error.code==='CONNECTION_FAILED'&&!error.message.includes('SECRET'));
});
test('bounded bytes and malformed UTF8/JSON reject',async()=>{
 await assert.rejects(reader(async()=>response([row(1)]),{maxResponseBytes:10}).readUsage(),{code:'RESPONSE_TOO_LARGE'});
 await assert.rejects(reader(async()=>new Response(new Uint8Array([255]))).readUsage(),{code:'INVALID_RESPONSE'});
});
test('timeout covers ignored fetch signal, abort covers ignored body signal and cancels body',async()=>{
 await assert.rejects(reader(()=>new Promise(()=>{}),{timeoutMs:10}).readUsage(),{code:'TIMEOUT'});
 let cancelled=false;const controller=new AbortController();
 const pending=reader(async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}}))).readUsage({signal:controller.signal});
 setTimeout(()=>controller.abort(),10);await assert.rejects(pending,{code:'CANCELLED'});assert.equal(cancelled,true);
});
