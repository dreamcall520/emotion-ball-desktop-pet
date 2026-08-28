const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ID = '019fae37-6bb8-7873-8873-14a6661bd1f1';
const tick = () => new Promise(resolve => setImmediate(resolve));
function api() {
  const file = path.resolve(__dirname, '../lib/codex-connection.js');
  assert.ok(fs.existsSync(file), '需要额度与任务两路独立组合连接');
  return require(file);
}
function harness({ account, quota, list, startRpc, startStream } = {}) {
  const calls = []; const statuses = []; const tasks = []; const accounts = []; const quotas = []; const streams = [];
  let rpcOptions;
  const connection = api().createCodexConnection({
    createRpc: options => {
      rpcOptions = options; calls.push('construct-rpc');
      return {
        start: async () => { calls.push('start-rpc'); await startRpc?.(); },
        readAccount: async () => { calls.push('account'); return account ? account() : { authenticated: true, accountKey: 'one' }; },
        readQuota: async () => { calls.push('quota'); return quota ? quota() : { windows: [], updatedAt: 100 }; },
        listThreads: async () => { calls.push('list'); return list ? list() : [{ id: ID, title: '任务', state: 'unknown', partial: true }]; },
        close: () => calls.push('close-rpc')
      };
    },
    createStream: options => {
      calls.push('construct-stream');
      const stream = {
        options, rows: [], closed: false,
        start: async () => { calls.push('start-stream'); await startStream?.(); options.onStatus({ state: 'connecting', code: null, partial: true }); },
        setThreads: rows => { calls.push('set-threads'); stream.rows = rows; },
        refresh: () => calls.push('refresh-stream'),
        close: () => { calls.push('close-stream'); stream.closed = true; }
      };
      streams.push(stream); return stream;
    },
    now: () => 100,
    onStatus: value => statuses.push(value), onTask: value => tasks.push(value), onQuota: value => quotas.push(value), onAccount: value => accounts.push(value)
  });
  return { connection, calls, statuses, tasks, accounts, quotas, streams, disconnectRpc: code => rpcOptions.onDisconnect(code) };
}

test('导入与构造不读取或连接Codex；未start的refresh也零I/O', async () => {
  const h = harness(); await h.connection.refresh(); h.connection.close(); await h.connection.start();
  assert.deepEqual(h.calls, []); assert.deepEqual(h.statuses, []);
});

test('start两路独立，额度已连接不冒充任务已收到snapshot', async () => {
  const h = harness(); await h.connection.start();
  assert.deepEqual(h.accounts, [{ accountKey: 'one' }]);
  assert.equal(h.quotas.length, 1); assert.equal(h.streams[0].rows.length, 1);
  assert.equal(h.statuses.some(s => s.channel === 'quota' && s.state === 'connected'), true);
  assert.equal(h.statuses.some(s => s.channel === 'tasks' && s.state === 'connected'), false);
  h.streams[0].options.onTask({ id: ID, title: '任务', state: 'active', turnId: 'one', updatedAt: 100, baseline: true, partial: true });
  h.streams[0].options.onStatus({ state: 'connected', code: null, partial: true });
  assert.equal(h.tasks.at(-1).state, 'active'); assert.equal(h.statuses.at(-1).channel, 'tasks');
  h.connection.close();
});

test('task-only refresh不读账号和额度，只刷新最近元数据', async () => {
  const h = harness(); await h.connection.start(); h.calls.length = 0;
  await h.connection.refresh({ quota: false, tasks: true });
  assert.deepEqual(h.calls, ['list', 'set-threads']);
  h.calls.length = 0; await h.connection.refresh({ quota: true, tasks: false });
  assert.deepEqual(h.calls, ['account', 'quota']);
  h.connection.close();
});

test('额度出错不关闭有效任务流，错误不泄露原始日志', async () => {
  const h = harness({ quota: () => { throw Object.assign(new Error('SECRET_CREDENTIAL'), { code: 'DISCONNECTED' }); } });
  await h.connection.start();
  assert.equal(h.statuses.some(s => s.channel === 'quota' && s.state === 'disconnected'), true);
  assert.equal(h.streams[0].rows.length, 1); assert.equal(h.streams[0].closed, false);
  assert.equal(JSON.stringify(h.statuses).includes('SECRET'), false);
  h.connection.close();
});

test('任务socket失败不影响额度读取', async () => {
  const h = harness({ startStream: () => { throw Object.assign(new Error('SECRET'), { code: 'UNSAFE_SOCKET' }); } });
  await h.connection.start();
  assert.equal(h.statuses.some(s => s.channel === 'tasks' && s.state === 'unsupported'), true);
  assert.equal(h.quotas.length, 1); h.connection.close();
});

test('首次无账号明确未登录；短暂读取错误不报告假账号切换', async () => {
  const h = harness({ account: () => ({ accountKey: null, authenticated: false }) });
  await h.connection.start();
  assert.deepEqual(h.accounts, [{ accountKey: null }]);
  assert.equal(h.calls.includes('quota'), false); assert.equal(h.calls.includes('list'), false);
  assert.ok(h.statuses.some(s => s.channel === 'quota' && s.state === 'unauthenticated'));
  h.connection.close();
  let failing = false;
  const transient = harness({ account: () => { if (failing) throw new Error('SECRET'); return { accountKey: 'one', authenticated: true }; } });
  await transient.connection.start(); failing = true; await transient.connection.refresh();
  assert.deepEqual(transient.accounts, [{ accountKey: 'one' }]);
  transient.connection.close();
});

test('账号切换先关旧流与清基线，再接受新任务；旧流晚到回调被丢弃', async () => {
  let key = 'one';
  const h = harness({ account: () => ({ accountKey: key, authenticated: true }) });
  await h.connection.start(); const old = h.streams[0]; key = 'two'; await h.connection.refresh();
  assert.deepEqual(h.accounts, [{ accountKey: 'one' }, { accountKey: 'two' }]);
  assert.equal(old.closed, true); assert.equal(h.streams.length, 2); assert.equal(h.streams[1].rows.length, 1);
  old.options.onTask({ id: ID, state: 'completed' });
  assert.equal(h.tasks.length, 0);
  h.connection.close();
});

test('成功确认不支持的账号类型时清旧身份和流，不能当临时错误或退出登录', async t => {
  let supported = true;
  const h = harness({ account: () => supported ? { accountKey: 'one', authenticated: true }
    : { accountKey: null, authenticated: null, supported: false } });
  t.after(() => h.connection.close()); await h.connection.start();
  const old = h.streams[0]; old.options.onStatus({ state: 'connected', code: null });
  supported = false; h.calls.length = 0; await h.connection.refresh();
  assert.deepEqual(h.accounts, [{ accountKey: 'one' }, { accountKey: null }]);
  assert.equal(old.closed, true); assert.equal(h.streams.length, 1);
  assert.equal(h.calls.includes('quota'), false); assert.equal(h.calls.includes('list'), false);
  for (const channel of ['quota', 'tasks']) {
    assert.equal(h.statuses.filter(value => value.channel === channel).at(-1).state, 'unsupported');
    assert.equal(h.statuses.filter(value => value.channel === channel).at(-1).code, 'UNSUPPORTED');
  }
  assert.equal(h.statuses.some(value => value.state === 'unauthenticated'), false);
  const count = h.statuses.length; old.options.onStatus({ state: 'connected', code: null }); old.options.onTask({ id: ID, state: 'completed' });
  assert.equal(h.statuses.length, count); assert.equal(h.tasks.length, 0);
  h.calls.length = 0; await h.connection.refresh({ quota: false }); assert.deepEqual(h.calls, []);
  await h.connection.refresh(); assert.equal(h.accounts.length, 2);
  supported = true; await h.connection.refresh();
  assert.deepEqual(h.accounts.at(-1), { accountKey: 'one' }); assert.equal(h.streams.length, 2);
  assert.equal(h.streams[1].rows.length, 1);
});

test('首次不支持的账号类型与明确退出登录分开报告，即使两者identity都是null', async t => {
  let loggedOut = false;
  const h = harness({ account: () => loggedOut ? { accountKey: null, authenticated: false }
    : { accountKey: null, authenticated: null, supported: false } });
  t.after(() => h.connection.close()); await h.connection.start();
  assert.equal(h.streams[0].closed, true);
  assert.equal(h.statuses.filter(value => value.channel === 'tasks').at(-1).state, 'unsupported');
  assert.equal(h.calls.includes('quota'), false); assert.equal(h.calls.includes('list'), false);
  loggedOut = true; await h.connection.refresh();
  assert.equal(h.accounts.length, 2);
  assert.equal(h.statuses.filter(value => value.channel === 'tasks').at(-1).state, 'unauthenticated');
});

test('损坏账号响应的读取错误不清空已知身份，也不关闭仍有效的任务通道', async t => {
  let broken = false;
  const h = harness({ account: () => {
    if (broken) throw Object.assign(new Error('UNSUPPORTED'), { code: 'UNSUPPORTED' });
    return { accountKey: 'one', authenticated: true };
  } });
  t.after(() => h.connection.close()); await h.connection.start();
  h.streams[0].options.onStatus({ state: 'connected', code: null }); broken = true;
  await h.connection.refresh();
  assert.deepEqual(h.accounts, [{ accountKey: 'one' }]); assert.equal(h.streams[0].closed, false);
  assert.equal(h.statuses.filter(value => value.channel === 'tasks').at(-1).state, 'connected');
});

test('新following不直接订阅，必须重新读合规元数据', async () => {
  const h = harness(); await h.connection.start(); h.calls.length = 0;
  h.streams[0].options.onDiscovered(ID); await tick();
  assert.deepEqual(h.calls, ['list', 'set-threads']); h.connection.close();
});

test('close立即停止两路并忽略所有未结束请求的迟到结果', async () => {
  let resolveQuota;
  const h = harness({ quota: () => new Promise(resolve => { resolveQuota = resolve; }) });
  const opening = h.connection.start();
  for (let i = 0; i < 10 && !resolveQuota; i++) await tick();
  h.connection.close(); h.connection.close();
  const before = { status: h.statuses.length, accounts: h.accounts.length, tasks: h.tasks.length };
  resolveQuota({ windows: [{ remaining: 10 }], updatedAt: 100 }); await opening;
  h.streams[0].options.onTask({ state: 'completed' }); h.disconnectRpc('DISCONNECTED');
  assert.equal(h.quotas.length, 0); assert.equal(h.tasks.length, before.tasks); assert.equal(h.statuses.length, before.status);
  assert.equal(h.calls.filter(c => c === 'close-rpc').length, 1);
  assert.equal(h.calls.filter(c => c === 'close-stream').length, 1);
});

test('同一路刷新有在途工作时合并，防止堆积请求', async () => {
  let finish; let slow = false;
  const h = harness({ list: () => slow ? new Promise(resolve => { finish = resolve; }) : [] });
  await h.connection.start(); h.calls.length = 0; slow = true;
  const first = h.connection.refresh({ quota: false }); const second = h.connection.refresh({ quota: false });
  await tick(); assert.equal(h.calls.filter(c => c === 'list').length, 1);
  finish([]); await Promise.all([first, second]); h.connection.close();
});

test('账号切换立即创建独立metadata读取，旧finally不清掉新代次在途请求', async t => {
  let accountKey = 'one'; let reads = 0; let finishOld; let finishNew;
  const h = harness({ account: () => ({ accountKey, authenticated: true }), list: () => {
    reads++;
    if (reads === 2) return new Promise(resolve => { finishOld = resolve; });
    if (reads === 3) return new Promise(resolve => { finishNew = resolve; });
    return [{ id: ID, title: '初始元数据' }];
  } });
  t.after(() => { h.connection.close(); finishOld?.([]); finishNew?.([]); });
  await h.connection.start();
  const oldRefresh = h.connection.refresh({ quota: false }); await tick();
  accountKey = 'two'; const newRefresh = h.connection.refresh();
  for (let i = 0; i < 5 && reads < 3; i++) await tick();
  assert.equal(reads, 3); assert.equal(h.streams.length, 2);
  finishOld([{ id: ID, title: '旧账号迟到元数据' }]); await oldRefresh;
  assert.deepEqual(h.streams[1].rows, []);
  const coalesced = h.connection.refresh({ quota: false }); await tick();
  assert.equal(reads, 3);
  const current = [{ id: ID, title: '新账号元数据' }]; finishNew(current);
  await Promise.all([newRefresh, coalesced]);
  assert.deepEqual(h.streams[1].rows, current);
});

test('旧账号metadata失败不能覆盖新账号正在获取状态的通道', async t => {
  let accountKey = 'one'; let reads = 0; let rejectOld; let finishNew;
  const h = harness({ account: () => ({ accountKey, authenticated: true }), list: () => {
    reads++;
    if (reads === 2) return new Promise((resolve, reject) => { rejectOld = reject; });
    if (reads === 3) return new Promise(resolve => { finishNew = resolve; });
    return [];
  } });
  t.after(() => { h.connection.close(); finishNew?.([]); });
  await h.connection.start();
  const oldRefresh = h.connection.refresh({ quota: false }); await tick();
  accountKey = 'two'; const newRefresh = h.connection.refresh(); await tick();
  rejectOld(Object.assign(new Error('DISCONNECTED'), { code: 'DISCONNECTED' })); await oldRefresh;
  assert.equal(h.statuses.filter(value => value.channel === 'tasks').at(-1).state, 'connecting');
  finishNew([]); await newRefresh;
});

test('部分任务过大的固定降级码透传，任务原因不影响额度通路', async () => {
  const h = harness(); await h.connection.start();
  h.streams[0].options.onStatus({ state: 'connected', code: 'PARTIAL_STATE' });
  h.streams[0].options.onTask({ id: ID, state: 'unknown', unavailable: 'STATE_TOO_LARGE', partial: true });
  assert.equal(h.statuses.at(-1).code, 'PARTIAL_STATE'); assert.equal(h.tasks.at(-1).unavailable, 'STATE_TOO_LARGE');
  assert.equal(h.quotas.length, 1); h.connection.close();
});
