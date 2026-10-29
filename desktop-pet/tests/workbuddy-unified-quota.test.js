const test = require('node:test');
const assert = require('node:assert/strict');
const { execute, sessionIdentity } = require('../lib/workbuddy-helper.cjs');
const basic = 'TCACA_code_008_cfWoLwvjU4', vip = 'TCACA_code_043_6oIkxT7Z0S';
const benefit = 'TCACA_code_007_nzdH5h4Nl0', legacy = 'TCACA_code_006_DbXS0lrypC';
const now = Date.now(), future = now + 30 * 86400000;
const auth = uid => ({ ...sessionIdentity({account:{uid,type:'personal'},auth:{domain:'www.workbuddy.cn'}}),token:'fixture-not-a-real-token' });
function row(code, left, overrides = {}) {
  return { ResourceId: 'fixture-' + code, ProductCode:'p_tcaca', CapacityUnit:'credits', PackageCode:code,
    Status:0, CapacityType:1, CycleCapacitySizePrecise:'10000', CycleCapacityRemainPrecise:String(left),
    CycleEndTime:future, DeductionEndTime:future, ...overrides };
}
function summary(entries, paid = false) {
  return { IsPaidUser:paid, Packages:entries.map(([PackageCode,left])=>({PackageCode,CycleRemainCapacity:String(left)})) };
}
function harness(t, {sum, rows, onPage, legacyRows, errorStatus} = {}) {
  const calls=[], previous=global.fetch; t.after(()=>global.fetch=previous);
  global.fetch=async(url,init)=>{
    const body=JSON.parse(init.body); calls.push({url,body,method:init.method});
    if(url.endsWith('get-user-resource-summary')) return new Response(JSON.stringify({code:0,data:sum}));
    if(url.endsWith('/v2/billing/meter/get-user-resource')) {
      if(errorStatus) return new Response('{}',{status:errorStatus});
      const data=onPage ? onPage(body,calls) : {Accounts:rows,TotalCount:rows.length};
      return new Response(JSON.stringify({code:0,data:{Response:{Data:data}}}));
    }
    if(legacyRows && url.endsWith('-packages')) {
      const selected=url.endsWith('free-packages')?legacyRows:[];
      return new Response(JSON.stringify({code:0,data:{Accounts:selected,TotalCount:selected.length}}));
    }
    throw new Error('unexpected endpoint: '+new URL(url).pathname);
  };
  return {calls,run:()=>execute('quota',{},()=>{},{authReader:()=>auth('fixture-a')})};
}
test('new official 043 personal plan reads unified resource endpoint and keeps existing breakdown',async t=>{
  const h=harness(t,{sum:summary([[vip,2400],[benefit,12.34]],true),rows:[row(vip,2400),row(benefit,12.34)]});
  const r=(await h.run()).report;
  assert.equal(r.total,2412.34);assert.equal(r.basic,2400);assert.equal(r.reward,12.34);assert.equal(r.plan,'个人付费版');
  assert.deepEqual(r.expires,[{amount:12.34,at:future}]);
  assert.equal(h.calls.length,2);
  const q=h.calls[1];assert.equal(q.method,'POST');assert.equal(q.body.ProductCode,'p_tcaca');assert.deepEqual(q.body.Status,[0,3]);
  assert.equal(q.body.PageNumber,1);assert.equal(q.body.PageSize,100);assert.equal(q.body.PackageCodes,undefined);
});
test('unified read continues beyond 100 resources and never double-counts page overlap',async t=>{
  const rows=Array.from({length:101},(_,i)=>row(benefit,1,{ResourceId:'fixture-'+i}));
  const h=harness(t,{sum:summary([[benefit,101]]),onPage:body=>({Accounts:rows.slice((body.PageNumber-1)*100,body.PageNumber*100),TotalCount:101})});
  assert.equal((await h.run()).report.total,101);
  assert.deepEqual(h.calls.slice(1).map(c=>c.body.PageNumber),[1,2]);
});
test('valid credit packages exclude spent/expired resources and explicit non-credit units',async t=>{
  const h=harness(t,{sum:summary([[basic,500],[legacy,10]]),rows:[
    row(basic,500),row(legacy,10,{CapacityUnit:'times'}),row(benefit,0,{Status:3}),row(benefit,99,{ResourceId:'expired',Status:2})
  ]});
  const r=(await h.run()).report;assert.equal(r.total,500);assert.equal(r.reward,0);assert.deepEqual(r.expires,[]);
});
test('daily slice mismatch uses existing daily detail source, not the larger monthly capacity',async t=>{
  const daily=row(basic,3000,{CapacityType:4}), detail={...daily,SlicePeriodUsageDetails:[{SlicePeriodCapacityRemainPrecise:'25.5'}]};
  const h=harness(t,{sum:summary([[basic,25.5]]),rows:[daily],legacyRows:[detail]});
  assert.equal((await h.run()).report.total,25.5);
  assert.equal(h.calls.length,4);assert(h.calls.some(c=>c.url.endsWith('free-packages')));
});
test('unsupported unified endpoint falls back once without retrying authentication or throttling',async t=>{
  await t.test('404 uses legacy details',async t=>{
    const r=row(basic,500),h=harness(t,{sum:summary([[basic,500]]),rows:[r],legacyRows:[r],errorStatus:404});
    assert.equal((await h.run()).report.total,500);assert.equal(h.calls.length,4);
  });
  for(const [status,code] of [[401,'LOGIN_REQUIRED'],[429,'RATE_LIMITED'],[503,'SERVICE_UNAVAILABLE']]) await t.test(String(status),async t=>{
    const h=harness(t,{sum:summary([[basic,500]]),errorStatus:status});
    await assert.rejects(h.run(),{code});assert.equal(h.calls.length,2);
  });
});
test('incomplete or conflicting resources cannot publish a plausible partial balance',async t=>{
  const cases=[
    {Accounts:[row(basic,500)],TotalCount:2},
    {Accounts:[row(basic,500),row(basic,499)],TotalCount:2},
    {Accounts:[row(basic,500,{CycleCapacityRemainPrecise:'bad'})],TotalCount:1},
    {Accounts:[row(basic,500,{Status:undefined})],TotalCount:1},
    {Accounts:[row(basic,500,{CapacityUnit:undefined})],TotalCount:1}
  ];
  for(const [i,page]of cases.entries()) await t.test(String(i),async t=>{
    const h=harness(t,{sum:summary([[basic,500]]),onPage:()=>page});
    await assert.rejects(h.run(),e=>['INVALID_RESPONSE','UNSUPPORTED_QUOTA'].includes(e.code));
  });
});
test('personal account switch between requests never combines different accounts',async t=>{
  let current=auth('fixture-a');
  const h=harness(t,{sum:summary([[basic,500]]),onPage:()=>{current=auth('fixture-b');return {Accounts:[row(basic,500)],TotalCount:1};}});
  await assert.rejects(execute('quota',{},()=>{},{authReader:()=>({...current})}),{code:'ACCOUNT_CHANGED'});
  assert.equal(h.calls.length,2);
});
test('empty active resource set remains a real zero balance',async t=>{
  const h=harness(t,{sum:summary([]),rows:[]});const r=(await h.run()).report;
  assert.equal(r.total,0);assert.equal(r.basic,0);assert.equal(r.nextRefreshAt,null);
});
test('exhausted base plan keeps its reset time without adding spendable credits',async t=>{
  const h=harness(t,{sum:summary([[basic,0]]),rows:[row(basic,0,{Status:3})]});
  const r=(await h.run()).report;assert.equal(r.total,0);assert.equal(r.nextRefreshAt,future+1000);
});
test('exhausted daily plan rejects contradictory spendable slice credits',async t=>{
  const h=harness(t,{sum:summary([[basic,50]]),rows:[row(basic,0,{Status:3,CapacityType:4,
    SlicePeriodUsageDetails:[{SlicePeriodCapacityRemainPrecise:'50'}]})]});
  await assert.rejects(h.run(),{code:'INVALID_RESPONSE'});assert.equal(h.calls.length,2);
});
