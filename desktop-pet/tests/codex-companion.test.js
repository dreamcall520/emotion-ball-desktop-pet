const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.join(__dirname, '../lib/codex-companion.js');
const taskId = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const settle = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(options = {}) {
  assert.ok(fs.existsSync(modulePath), 'Codex companion policy module must exist');
  const { createCodexCompanion } = require(modulePath);
  let time = 1000000;
  let nextTimer = 0;
  let present = true;
  const timers = new Map();
  const connections = [];
  const alerts = [];
  const changes = [];
  const clears = [];
  const calls = [];
  const companion = createCodexCompanion({
    now: () => time,
    schedule: (callback, delay) => { const id = ++nextTimer; timers.set(id, { at: time + delay, callback }); return id; },
    cancel: id => timers.delete(id),
    canPresent: () => present,
    onAlert: alert => alerts.push(alert),
    onChange: snapshot => changes.push(snapshot),
    onClear: () => clears.push(time),
    createConnection: callbacks => {
      const index = connections.length;
      const connection = {
        callbacks, closed: false,
        start() {
          calls.push({ kind: 'start', index, at: time });
          if (options.start) return options.start(callbacks, index);
          callbacks.onAccount({ accountKey: 'account-one' });
          for (const channel of ['quota', 'tasks']) callbacks.onStatus({ channel, state: 'connected', code: null });
          return Promise.resolve();
        },
        refresh(value) { calls.push({ kind: 'refresh', index, at: time, ...value }); return options.refresh?.(callbacks, value) || Promise.resolve(); },
        retry(value) { calls.push({ kind: 'retry', index, at: time, ...value }); return options.retry?.(callbacks, value) || Promise.resolve(); },
        close() { connection.closed = true; calls.push({ kind: 'close', index, at: time }); }
      };
      connections.push(connection);
      return connection;
    }
  });
  return {
    companion, connections, alerts, changes, clears, calls, timers,
    get time() { return time; },
    get callbacks() { return connections.at(-1).callbacks; },
    setPresent: value => { present = value; },
    async tick(ms) {
      const target = time + ms;
      for (;;) {
        await settle();
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); time = next[1].at; next[1].callback();
      }
      time = target;
      await settle();
    },
    quota(remaining, overrides = {}) {
      this.callbacks.onQuota({ windows: [{ id: 'codex:primary', label: 'Codex', windowMinutes: 300, remaining, resetsAt: 9000000 }], updatedAt: time, ...overrides });
    },
    task(n, state, overrides = {}) {
      this.callbacks.onTask({ id: taskId(n), title: `任务 ${n}`, state, turnId: `turn-${n}`, updatedAt: time, partial: true, baseline: false, ...overrides });
    }
  };
}

test('默认关闭：构造、快照、刷新和关闭均无连接或定时器', async () => {
  const f = fixture();
  assert.equal(f.companion.getSnapshot().enabled, false);
  assert.equal(await f.companion.refresh(), false);
  await f.companion.setEnabled(false);
  await f.companion.setEnabled('true');
  f.companion.close();
  await f.companion.setEnabled(true);
  assert.equal(f.connections.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.changes.length, 0);
});

test('快速开关只关闭自己连接，丢弃旧代次迟到结果', async () => {
  const opening = deferred();
  const f = fixture({ start: () => opening.promise });
  const first = f.companion.setEnabled(true);
  const old = f.callbacks;
  await f.companion.setEnabled(false);
  const next = f.companion.setEnabled(true);
  old.onAccount({ accountKey: 'stale-account' });
  old.onQuota({ windows: [{ id: 'old', remaining: 1 }], updatedAt: f.time });
  old.onTask({ id: taskId(1), title: '旧任务', state: 'completed' });
  old.onStatus({ channel: 'tasks', state: 'connected' });
  assert.equal(f.connections[0].closed, true);
  assert.equal(f.connections[1].closed, false);
  assert.deepEqual(f.companion.getSnapshot().quota.windows, []);
  assert.deepEqual(f.companion.getSnapshot().tasks.items, []);
  assert.equal(f.companion.getSnapshot().tasks.state, 'connecting');
  opening.resolve(); await Promise.all([first, next]);
  await f.companion.setEnabled(false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.connections[1].closed, true);
});

test('任务15秒轮询、额度120秒，互不额外读取另一项', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  await f.tick(119999);
  assert.equal(f.calls.filter(call => call.kind === 'refresh' && call.tasks).length, 7);
  assert.equal(f.calls.filter(call => call.kind === 'refresh' && call.quota).length, 0);
  await f.tick(1);
  assert.equal(f.calls.filter(call => call.kind === 'refresh' && call.tasks).length, 8);
  assert.equal(f.calls.filter(call => call.kind === 'refresh' && call.quota).length, 1);
  for (const call of f.calls.filter(call => call.kind === 'refresh')) assert.notEqual(call.quota, call.tasks);
});

test('手动刷新重建连接，十秒内及并发刷新不重复', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  const oldGeneration = f.companion.getSnapshot().generation;
  const results = await Promise.all([f.companion.refresh(), f.companion.refresh(), f.companion.refresh()]);
  assert.deepEqual(results, [true, false, false]);
  assert.equal(f.connections.length, 2);
  assert.equal(f.connections[0].closed, true);
  assert.ok(f.companion.getSnapshot().generation > oldGeneration);
  await f.tick(9999);
  assert.equal(await f.companion.refresh(), false);
  await f.tick(1);
  assert.equal(await f.companion.refresh(), true);
  assert.equal(f.connections.length, 3);
});

test('两路失败分别退避30/60/120秒，健康额度不重置任务失败计数', async () => {
  const f = fixture({ retry: callbacks => callbacks.onStatus({ channel: 'quota', state: 'connected', code: null }) });
  await f.companion.setEnabled(true);
  f.callbacks.onStatus({ channel: 'tasks', state: 'disconnected', code: 'TIMEOUT' });
  await f.tick(30000);
  await f.tick(60000);
  await f.tick(120000);
  await f.tick(120000);
  assert.deepEqual(f.calls.filter(call => call.kind === 'retry').map(call => call.at), [1030000, 1090000, 1210000, 1330000]);
  assert.ok(f.calls.filter(call => call.kind === 'retry').every(call => call.tasks && !call.quota));
  assert.equal(f.connections.length, 1);
  assert.equal(f.companion.getSnapshot().quota.state, 'connected');
});

test('缺失、未登录和不支持通道停止自动重试，另一项仍工作', async () => {
  for (const state of ['missing', 'unauthenticated', 'unsupported']) {
    const f = fixture();
    await f.companion.setEnabled(true);
    f.callbacks.onStatus({ channel: 'tasks', state, code: 'UNSUPPORTED' });
    await f.tick(360000);
    assert.equal(f.calls.filter(call => call.kind === 'retry' || call.tasks).length, 0);
    assert.equal(f.calls.filter(call => call.kind === 'refresh' && call.quota).length, 3);
    assert.equal(f.companion.getSnapshot().tasks.state, state);
    await f.companion.refresh();
    assert.equal(f.connections.length, 2);
    f.companion.close();
  }
});

test('关闭取消进行中刷新，旧finally不重建定时器或覆盖新连接', async () => {
  const pending = deferred();
  const f = fixture({ refresh: () => pending.promise });
  await f.companion.setEnabled(true);
  await f.tick(15000);
  const old = f.callbacks;
  await f.companion.setEnabled(false);
  assert.equal(f.timers.size, 0);
  await f.companion.setEnabled(true);
  old.onStatus({ channel: 'tasks', state: 'unsupported', code: 'UNSUPPORTED' });
  pending.resolve(); await settle();
  assert.equal(f.companion.getSnapshot().tasks.state, 'connected');
  await f.companion.setEnabled(false);
  assert.equal(f.timers.size, 0);
});

test('额度五分钟未成功更新标过期；健康任务没有事件不被猜成完成', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.quota(70);
  f.task(1, 'active', { baseline: true });
  await f.tick(299999);
  assert.equal(f.companion.getSnapshot().quota.stale, false);
  await f.tick(1);
  assert.equal(f.companion.getSnapshot().quota.stale, true);
  assert.equal(f.companion.getSnapshot().quota.updatedAt, 1000000);
  assert.equal(f.companion.getSnapshot().tasks.items[0].state, 'active');
  assert.equal(f.alerts.length, 0);
});

test('同状态增量只更新时间，不反复刷新菜单；状态和标题变化会通知', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true });
  const count = f.changes.length;
  for (let n = 1; n <= 60; n++) f.task(1, 'active', { updatedAt: f.time + n });
  assert.equal(f.changes.length, count);
  assert.equal(f.companion.getSnapshot().tasks.items[0].updatedAt, f.time + 60);
  f.task(1, 'active', { title: '新的可靠标题' });
  assert.equal(f.changes.length, count + 1);
  f.task(1, 'waiting');
  assert.ok(f.changes.length > count + 1);
});

test('切换账号清旧数据但同连接未来新账号回调仍可用', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.quota(70); f.task(1, 'active', { baseline: true });
  const generation = f.companion.getSnapshot().generation;
  f.callbacks.onAccount({ accountKey: 'account-two' });
  assert.deepEqual(f.companion.getSnapshot().quota.windows, []);
  assert.deepEqual(f.companion.getSnapshot().tasks.items, []);
  assert.ok(f.companion.getSnapshot().generation > generation);
  f.quota(90); f.task(2, 'active', { baseline: true });
  assert.equal(f.companion.getSnapshot().quota.windows[0].remaining, 90);
  assert.equal(f.companion.getSnapshot().tasks.items[0].id, taskId(2));
  assert.equal(f.connections.length, 1);
});

test('快照只留白名单字段且调用方修改快照不污染控制器', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true, body: 'SECRET_BODY', url: 'file:///SECRET' });
  f.quota(70, { accountKey: 'SECRET_ACCOUNT' });
  const snapshot = f.companion.getSnapshot();
  assert.equal(JSON.stringify(snapshot).includes('SECRET'), false);
  snapshot.tasks.items[0].title = '修改';
  snapshot.quota.windows[0].remaining = 0;
  assert.equal(f.companion.getSnapshot().tasks.items[0].title, '任务 1');
  assert.equal(f.companion.getSnapshot().quota.windows[0].remaining, 70);
});
