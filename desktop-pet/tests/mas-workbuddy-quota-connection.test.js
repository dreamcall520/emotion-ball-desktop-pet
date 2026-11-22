'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMasWorkBuddyQuotaConnection } = require('../lib/mas-workbuddy-quota-connection');

function fixture() {
  const events = [];
  let report = null, grant = 'needs-authorization';
  const access = { ensure: async options => { events.push(options.interactive); return { status: grant }; },
    revoke: async () => { grant = 'needs-authorization'; events.push('revoke'); }, clearPendingApp() {} };
  const quota = { setEnabled: value => events.push(['quota', value]), getState: () => ({ report }), close() {} };
  const usage = { setEnabled: value => events.push(['usage', value]), close() {} };
  const flow = createMasWorkBuddyQuotaConnection({ access, quota, usage,
    saveEnabled: value => events.push(['save', value]) });
  return { events, flow, set grant(value) { grant = value; }, set report(value) { report = value; }, access };
}
test('startup never opens a picker or enables reads without the two grants', async () => {
  const f = fixture(); await f.flow.restore(true);
  assert.equal(f.flow.getState().status, 'needs-authorization');
  assert.equal(f.flow.getState().connected, false);
  assert.deepEqual(f.events, [false]);
});
test('connect requires existing consent and restored grants; disconnect stops queries and clears authority', async () => {
  const f = fixture(); assert.equal((await f.flow.connect()).status, 'needs-authorization');
  assert.equal(f.events.some(item => Array.isArray(item) && item[0] === 'save'), false);
  f.grant = 'stored'; await f.flow.connect();
  assert.equal(f.flow.getState().connected, true);
  f.report = { total: 123 }; assert.equal(f.flow.getState().status, 'ready');
  await f.flow.disconnect(); assert.equal(f.flow.getState().connected, false);
  assert.ok(f.events.findIndex(item => item[0] === 'quota' && item[1] === false) < f.events.indexOf('revoke'));
});
test('late restore after disconnect cannot enable the provider or overwrite disconnected state', async () => {
  const f = fixture(); let resolve;
  f.access.ensure = () => new Promise(done => { resolve = done; });
  const pending = f.flow.restore(true); await Promise.resolve();
  await f.flow.disconnect(); resolve({ status: 'stored' }); await pending;
  assert.equal(f.flow.getState().connected, false);
  assert.equal(f.events.some(item => item[0] === 'quota' && item[1] === true), false);
});
test('failure saving the disabled preference still revokes authority', async () => {
  let revoked = false;
  const flow = createMasWorkBuddyQuotaConnection({ access: { clearPendingApp() {}, revoke: async () => { revoked = true; } },
    quota: { getState: () => ({}), setEnabled() {} }, usage: { setEnabled() {} },
    saveEnabled: async () => { throw Error('disk unavailable'); } });
  await assert.rejects(flow.disconnect());
  assert.equal(revoked, true);
});
test('closing the settings dialog during a connection never persists enabled', async () => {
  const f = fixture(), controller = new AbortController();
  f.access.ensure = async () => { controller.abort(); return { status: 'stored' }; };
  assert.equal((await f.flow.connect(controller.signal)).status, 'cancelled');
  assert.equal(f.events.some(item => item[0] === 'save'), false);
});
test('reauthorization clears the old permission failure and actually retries a real quota controller', async () => {
  const { createWorkBuddyQuota } = require('../lib/workbuddy-quota');
  let calls = 0, granted = false;
  const quota = createWorkBuddyQuota({ watchAuth: () => () => {}, schedule: () => 1, cancel() {},
    run: async () => { calls++; if (!granted) throw Object.assign(Error(), { code: 'DIRECTORY_ACCESS_REQUIRED' });
      return { accountKey: 'a'.repeat(64), report: { total: 7 } }; } });
  const flow = createMasWorkBuddyQuotaConnection({ access: { ensure: async () => ({ status: 'stored' }), clearPendingApp() {} },
    quota, usage: { setEnabled() {}, close() {} }, saveEnabled() {} });
  await flow.connect(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(flow.getState().status, 'needs-authorization');
  granted = true; await flow.connect(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2); assert.equal(flow.getState().status, 'ready'); flow.close();
});
test('task access is optional on restore and a separate consent never changes quota connection', async () => {
 const calls=[];let taskGranted=false,taskEnabled=false;
 const flow=createMasWorkBuddyQuotaConnection({
  access:{ensure:async()=>({status:'stored'}),clearPendingApp(){},revoke:async()=>{}},
  quota:{setEnabled(){},getState:()=>({report:{total:8351}})},usage:{setEnabled(){}},saveEnabled(){},
  taskAccess:{ensure:async({interactive})=>{calls.push(interactive);if(interactive)taskGranted=true;return{status:taskGranted?'stored':'needs-authorization'};},revoke:async()=>{taskGranted=false;}},
  tasks:{getState:()=>({}),setEnabled:v=>{taskEnabled=v;},refresh:async()=>{calls.push('read-tasks');}}
 });
 await flow.restore(true);await new Promise(r=>setImmediate(r));
 assert.equal(flow.getState().connected,true);assert.equal(flow.getState().tasks.authorized,false);assert.deepEqual(calls,[false]);
 await flow.authorizeTasks();assert.equal(flow.getState().tasks.authorized,true);assert.equal(taskEnabled,true);assert.ok(calls.includes('read-tasks'));
 await flow.revokeTasks();assert.equal(taskEnabled,false);assert.equal(flow.getState().tasks.authorized,false);assert.equal(flow.getState().connected,true);
});
test('cancelled task selection retains the connected quota and never enables metadata reads',async()=>{
 let taskEnabled=false;
 const flow=createMasWorkBuddyQuotaConnection({access:{ensure:async()=>({status:'stored'}),clearPendingApp(){}},
 quota:{setEnabled(){},getState:()=>({report:{total:9}})},usage:{setEnabled(){}},saveEnabled(){},
 taskAccess:{ensure:async({interactive})=>({status:interactive?'cancelled':'needs-authorization'})},
 tasks:{getState:()=>({}),setEnabled:v=>{taskEnabled=v;},refresh:async()=>{throw Error('unapproved read');}}});
 await flow.connect();await new Promise(r=>setImmediate(r));
 assert.equal((await flow.authorizeTasks()).status,'cancelled');assert.equal(flow.getState().connected,true);assert.equal(taskEnabled,false);
});

test('task opt-out takes precedence over residual native grants on startup and reconnect while quota remains connected',async()=>{
 const events=[];let taskEnabled=false;
 const flow=createMasWorkBuddyQuotaConnection({access:{ensure:async()=>({status:'stored'}),clearPendingApp(){}},
  quota:{setEnabled:v=>events.push(['quota',v]),getState:()=>({report:{total:9}})},usage:{setEnabled(){}},saveEnabled(){},
  taskAccess:{ensure:async()=>{events.push('task-grant-read');return{status:'stored'};}},
  tasks:{getState:()=>({}),setEnabled:v=>{taskEnabled=v;},refresh:async()=>events.push('task-data-read')}});
 await flow.restore(true,{tasksEnabled:false});await new Promise(r=>setImmediate(r));
 assert.equal(flow.getState().connected,true);assert.equal(flow.getState().tasks.authorized,false);assert.equal(taskEnabled,false);assert.equal(events.includes('task-grant-read'),false);
 await flow.connect(undefined,{tasksEnabled:false});await new Promise(r=>setImmediate(r));assert.equal(events.includes('task-data-read'),false);
 await flow.authorizeTasks();assert.equal(taskEnabled,true);assert.equal(events.includes('task-data-read'),true);
});

test('task opt-out overtakes a background grant restore already awaiting source access',async()=>{
 let release,taskEnabled=false;const events=[];
 const flow=createMasWorkBuddyQuotaConnection({access:{ensure:async()=>({status:'stored'}),clearPendingApp(){}},
  quota:{setEnabled(){},getState:()=>({report:{total:1}})},usage:{setEnabled(){}},saveEnabled(){},
  taskAccess:{ensure:async()=>new Promise(r=>{release=r;})},
  tasks:{getState:()=>({}),setEnabled:v=>{taskEnabled=v;},refresh:async()=>events.push('read')}});
 await flow.restore(true);await new Promise(r=>setImmediate(r));await flow.restore(true,{tasksEnabled:false});
 release({status:'stored'});await new Promise(r=>setImmediate(r));assert.equal(taskEnabled,false);assert.deepEqual(events,[]);assert.equal(flow.getState().connected,true);
});
