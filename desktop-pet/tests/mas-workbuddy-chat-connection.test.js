'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createMasWorkBuddyChatConnection } = require('../lib/mas-workbuddy-chat-connection');
const A = 'a'.repeat(64), B = 'b'.repeat(64);
const consent = accountKey => ({ version: 1, purpose: 'workbuddy-chat-v1', enabled: true, accountKey });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(saved = null, overrides = {}) {
  let record = saved, account = A, disabled = 0; const calls = [], changes = [];
  const storage = { load: async provider => { calls.push(['load', provider]); return record; },
    save: async (provider, value) => { calls.push(['save', provider]); record = value; },
    remove: async provider => { calls.push(['remove', provider]); record = null; }, ...overrides };
  const flow = createMasWorkBuddyChatConnection({ storage, getAccountKey: () => account,
    onDisable: () => { disabled++; }, onChange: state => changes.push(state) });
  return { flow, storage, calls, changes, account: value => { account = value; }, record: () => record, disabled: () => disabled };
}
test('积分授权和任意旧consent不会自动启用聊天', async () => {
  for (const saved of [null, { version: 1, accountKey: A }, { ...consent(A), purpose: 'workbuddy-animation-v1' }]) {
    const f = fixture(saved); await f.flow.restore();
    assert.equal(f.flow.getAuthorizedAccountKey(), null); assert.equal(f.flow.getState().enabled, false);
    assert.equal(f.calls.some(call => call[0] === 'save'), false);
  }
});
test('明确启用后只保存当前账号和独立聊天用途，投影不含账号或token', async () => {
  const f = fixture(); const state = await f.flow.enable();
  assert.equal(state.status, 'ready'); assert.deepEqual(f.record(), consent(A));
  assert.equal(f.flow.getAuthorizedAccountKey(), A); assert.equal(f.flow.getState().authorized, true);
  assert.deepEqual(f.calls, [['save', 'workbuddy']]);
  assert.deepEqual(Object.keys(f.flow.getState()).sort(), ['authorized', 'enabled', 'message', 'status']);
  assert.equal(JSON.stringify(f.changes).includes(A), false);
});
test('当前积分连接未确认账号时不能保存或启用聊天', async () => {
  const f = fixture(); f.account(null);
  assert.equal((await f.flow.enable()).status, 'needs-connection');
  assert.equal(f.flow.getAuthorizedAccountKey(), null); assert.equal(f.calls.length, 0);
});
test('已同意账号重启可恢复；启动尚无账号仅等待，不借用其他账号', async () => {
  const f = fixture(consent(A)); f.account(null); await f.flow.restore();
  assert.equal(f.disabled(), 0, 'startup must not revoke an independent saved chat-data grant');
  assert.equal(f.flow.getState().status, 'waiting-account'); assert.equal(f.flow.getAuthorizedAccountKey(), null);
  f.account(A); await f.flow.refreshAccount(); assert.equal(f.flow.getAuthorizedAccountKey(), A);
  const g = fixture(consent(A)); g.account(B); await g.flow.restore();
  assert.equal(g.flow.getState().status, 'account-changed'); assert.equal(g.flow.getAuthorizedAccountKey(), null); assert.equal(g.record(), null);
});
test('账号变化在同步runner getter处立即撤权取消，回到原账号也不复活', async () => {
  const f = fixture(); await f.flow.enable(); const generation = f.flow.getGeneration(), disabled = f.disabled();
  f.account(B); assert.equal(f.flow.getAuthorizedAccountKey(), null);
  assert(f.disabled() > disabled); assert(f.flow.getGeneration() > generation);
  await f.flow.refreshAccount(); assert.equal(f.record(), null);
  f.account(A); await f.flow.refreshAccount(); assert.equal(f.flow.getAuthorizedAccountKey(), null);
});
test('连接暂时没有可确认账号时停止请求，原账号仍需刷新后才能恢复已有consent', async () => {
  const f = fixture(); await f.flow.enable(); const disabled = f.disabled(); f.account(null);
  assert.equal(f.flow.getAuthorizedAccountKey(), null); assert(f.disabled() > disabled);
  assert.equal(f.flow.getState().authorized, false); f.account(A);
  assert.equal(f.flow.getAuthorizedAccountKey(), null); await f.flow.refreshAccount(); assert.equal(f.flow.getAuthorizedAccountKey(), A);
});
test('整体断开同步撤权，清除consent，同账号再次连接不能自动继承', async () => {
  const f = fixture(); await f.flow.enable(); const generation = f.flow.getGeneration();
  const disabling = f.flow.disable(); assert.equal(f.flow.getAuthorizedAccountKey(), null);
  assert(f.flow.getGeneration() > generation); await disabling; assert.equal(f.record(), null);
  await f.flow.refreshAccount(); assert.equal(f.flow.getState().enabled, false);
});
test('撤销覆盖迟到的restore读取', async () => {
  const gate = deferred(); const f = fixture(consent(A), { load: () => gate.promise });
  const restoring = f.flow.restore(); await Promise.resolve(); const disabling = f.flow.disable();
  gate.resolve(consent(A)); await Promise.all([restoring, disabling]);
  assert.equal(f.flow.getAuthorizedAccountKey(), null); assert.equal(f.record(), null);
});
test('撤销覆盖正在保存的enable，且随后重授权获得新代际', async () => {
  const gate = deferred(), started = deferred(); let saves = 0;
  const f = fixture(null); const original = f.storage.save;
  f.storage.save = async (...args) => { if (++saves === 1) { started.resolve(); await gate.promise; } await original(...args); };
  const enabling = f.flow.enable(); await started.promise; const old = f.flow.getGeneration();
  const disabling = f.flow.disable(); const next = f.flow.enable(); gate.resolve();
  assert.equal((await enabling).status, 'cancelled'); await disabling; await next;
  assert(f.flow.getGeneration() > old); assert.equal(f.flow.getAuthorizedAccountKey(), A); assert.deepEqual(f.record(), consent(A));
});
test('保存途中账号改变时删除旧同意，不承认迟到的save', async () => {
  const gate = deferred(), started = deferred(); const f = fixture(); const original = f.storage.save;
  f.storage.save = async (...args) => { started.resolve(); await gate.promise; await original(...args); };
  const enabling = f.flow.enable(); await started.promise; f.account(B); gate.resolve();
  assert.equal((await enabling).status, 'account-changed'); assert.equal(f.record(), null);
  assert.equal(f.flow.getAuthorizedAccountKey(), null);
});
test('重新启用尚未开始保存前账号改变也清除磁盘旧consent', async () => {
  const f = fixture(); await f.flow.enable();
  const enabling = f.flow.enable(); f.account(B);
  assert.equal((await enabling).status, 'account-changed'); assert.equal(f.record(), null);
});
test('保存失败不启用聊天且不暴露原始异常', async () => {
  const f = fixture(null, { save: async () => { throw Error('private path or token'); } });
  assert.equal((await f.flow.enable()).status, 'error'); assert.equal(f.flow.getAuthorizedAccountKey(), null);
  assert.doesNotMatch(JSON.stringify(f.flow.getState()), /private|token/);
});
test('关闭立即取消请求并使迟到enable失效，正常退出保留已确认的同意', async () => {
  const f = fixture(); await f.flow.enable(); const disabled = f.disabled(); f.flow.close();
  assert(f.disabled() > disabled); assert.equal(f.flow.getAuthorizedAccountKey(), null); assert.deepEqual(f.record(), consent(A));
  assert.equal((await f.flow.enable()).status, 'cancelled');
  const gate = deferred(), started = deferred(), g = fixture(); const original = g.storage.save;
  g.storage.save = async (...args) => { started.resolve(); await gate.promise; await original(...args); };
  const enabling = g.flow.enable(); await started.promise; g.flow.close(); gate.resolve();
  assert.equal((await enabling).status, 'cancelled'); assert.equal(g.record(), null);
});
