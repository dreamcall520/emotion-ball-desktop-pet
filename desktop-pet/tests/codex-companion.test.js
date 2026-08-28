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
    canPresent: () => options.canPresent ? options.canPresent(companion) : present,
    onAlert: alert => alerts.push(alert),
    onChange: snapshot => { changes.push(snapshot); options.onChange?.(snapshot, companion); },
    onClear: () => { clears.push(time); options.onClear?.(companion); },
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

test('额度阈值先合并五秒，同周期每档一次且一次跨档只报严重档', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.quota(20);
  await f.tick(2000);
  f.quota(9);
  await f.tick(2999);
  assert.equal(f.alerts.length, 0);
  await f.tick(1);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.alerts[0].kind, 'quota');
  assert.equal(f.alerts[0].motion, 'bow');
  assert.match(f.alerts[0].text, /9%/);
  f.quota(15); await f.tick(30000);
  f.quota(8); await f.tick(30000);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.companion.getSnapshot().recent.length, 1);
});

test('20%后降到10%可再提醒，新周期和不同类别独立去重', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.quota(20); await f.tick(5000);
  f.quota(10); await f.tick(29999);
  assert.equal(f.alerts.length, 1);
  await f.tick(1);
  assert.equal(f.alerts.length, 2);
  f.quota(9, { windows: [
    { id: 'codex:primary', label: 'Codex', windowMinutes: 300, remaining: 9, resetsAt: 10000000 },
    { id: 'spark:primary', label: 'Spark', windowMinutes: 300, remaining: 18, resetsAt: 9000000 }
  ] });
  await f.tick(30000);
  assert.equal(f.alerts.length, 3);
  assert.match(f.alerts[2].text, /2/);
});

test('未知、已过期和未来时间额度不生成预警或伪造周期', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  for (const overrides of [
    { updatedAt: f.time - 300001 }, { updatedAt: f.time + 1 },
    { windows: [{ id: 'x', label: 'x', windowMinutes: 300, remaining: 1, resetsAt: 'unknown' }] },
    { windows: [{ id: 'x', label: 'x', windowMinutes: 'unknown', remaining: 1, resetsAt: 9000000 }] },
    { windows: [{ id: 'x', label: 'x', windowMinutes: 300, remaining: 'unknown', resetsAt: 9000000 }] },
    { windows: [{ id: 'x', label: 'x', windowMinutes: 300, remaining: 1, resetsAt: f.time - 1 }] }
  ]) f.quota(1, overrides);
  await f.tick(30000);
  assert.equal(f.alerts.length, 0);
  assert.equal(f.companion.getSnapshot().recent.length, 0);
});

test('同账号重建连接保留额度去重和历史，关闭重开则清空', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.quota(10); await f.tick(5000);
  const old = f.companion.getSnapshot().currentAlert;
  await f.companion.refresh();
  assert.equal(f.companion.getSnapshot().recent.length, 1);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  assert.equal(f.companion.dismiss(old.id, old.generation), false);
  f.quota(10); await f.tick(30000);
  assert.equal(f.alerts.length, 1);
  await f.companion.setEnabled(false);
  assert.equal(f.companion.getSnapshot().recent.length, 0);
  await f.companion.setEnabled(true);
  f.quota(10); await f.tick(5000);
  assert.equal(f.alerts.length, 2);
});

test('切换账号清空额度提醒基线、当前提示及排队，新账号数据仍接收', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.quota(10);
  f.callbacks.onAccount({ accountKey: 'account-two' });
  assert.equal(f.companion.getSnapshot().recent.length, 0);
  await f.tick(5000);
  assert.equal(f.alerts.length, 0);
  f.quota(10); await f.tick(5000);
  assert.equal(f.alerts.length, 1);
});

test('首次与重连基线不回放历史完成、失败、等待和运行提示', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  for (const [index, state] of ['completed', 'failed', 'waiting', 'active', 'interrupted'].entries()) f.task(index, state, { baseline: true });
  await f.tick(10000);
  assert.equal(f.alerts.length, 0);
  await f.companion.refresh();
  f.task(1, 'active', { baseline: true });
  f.task(1, 'completed', { baseline: true });
  await f.tick(30000);
  assert.equal(f.alerts.length, 0);
});

test('真实运行变化复用sway且无气泡，等待/完成/失败分别peek/hop/jelly', async () => {
  for (const [state, motion] of [['active', 'sway'], ['waiting', 'peek'], ['completed', 'hop'], ['failed', 'jelly']]) {
    const f = fixture();
    await f.companion.setEnabled(true);
    f.task(1, state === 'active' ? 'idle' : 'active', { baseline: true });
    f.task(1, state);
    await f.tick(5000);
    assert.equal(f.alerts.length, 1, state);
    assert.equal(f.alerts[0].kind, state);
    assert.equal(f.alerts[0].motion, motion);
    assert.equal(f.alerts[0].text === null, state === 'active');
    assert.deepEqual(f.alerts[0].taskIds, [taskId(1)]);
    assert.equal(JSON.stringify(f.alerts[0]).includes('任务 1'), false);
    f.companion.close();
  }
});

test('unknown、idle和interrupted不庆祝；unknown恢复旧终态也不误报', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  for (const [index, state] of ['unknown', 'idle', 'interrupted'].entries()) {
    f.task(index, 'active', { baseline: true }); f.task(index, state);
  }
  f.task(4, 'unknown', { baseline: true }); f.task(4, 'completed');
  await f.tick(10000);
  assert.equal(f.alerts.length, 0);
});

test('同轮终态去重，未知后恢复同轮不重复；新轮次仍可提醒', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true }); f.task(1, 'completed');
  await f.tick(5000);
  f.task(1, 'completed'); f.task(1, 'unknown'); f.task(1, 'active', { baseline: true }); f.task(1, 'completed');
  await f.tick(30000);
  assert.equal(f.alerts.length, 1);
  f.task(1, 'active', { turnId: 'new-turn', baseline: true });
  f.task(1, 'completed', { turnId: 'new-turn' });
  await f.tick(5000);
  assert.equal(f.alerts.length, 2);
});

test('等待恢复运行后再次等待可提醒，但所有类型共享30秒间隔', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true }); f.task(1, 'waiting');
  await f.tick(5000);
  f.task(1, 'waiting'); await f.tick(1000);
  f.task(1, 'active'); f.task(1, 'waiting');
  await f.tick(28999);
  assert.equal(f.alerts.length, 1);
  await f.tick(1);
  assert.equal(f.alerts.length, 2);
  assert.equal(f.alerts[1].kind, 'waiting');
  assert.equal(f.alerts[1].createdAt, 1006000);
});

test('五秒内同类任务合并，气泡不包含任务标题和正文', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true }); f.task(1, 'waiting', { title: 'SECRET_TITLE', body: 'SECRET_BODY' });
  await f.tick(4000);
  f.task(2, 'active', { baseline: true }); f.task(2, 'waiting');
  await f.tick(1000);
  assert.equal(f.alerts.length, 1);
  assert.deepEqual(f.alerts[0].taskIds, [taskId(1), taskId(2)]);
  assert.equal(JSON.stringify(f.alerts).includes('SECRET'), false);
  assert.equal(f.companion.getSnapshot().recent.length, 1);
});

test('忙碌/睡眠时延后，60秒过期后仅留菜单，不补播', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.setPresent(false);
  f.task(1, 'active', { baseline: true }); f.task(1, 'waiting');
  await f.tick(60000);
  f.setPresent(true); await f.tick(10000);
  assert.equal(f.alerts.length, 0);
  assert.equal(f.companion.getSnapshot().recent.length, 1);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
});

test('忙碌解除且未过期时可显示，显示8秒后按钮失效', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.setPresent(false);
  f.task(1, 'active', { baseline: true }); f.task(1, 'waiting');
  await f.tick(9000);
  f.setPresent(true); await f.tick(1000);
  const current = f.companion.getSnapshot().currentAlert;
  assert.equal(f.alerts.length, 1);
  assert.equal(current.expiresAt, f.time + 8000);
  assert.equal(f.companion.dismiss(current.id + 1, current.generation), false);
  await f.tick(8000);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  assert.equal(f.companion.dismiss(current.id, current.generation), false);
});

test('等待状态被取代后剔除合并提醒中的旧任务，新轮次不补播旧完成', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  for (const n of [1, 2]) { f.task(n, 'active', { baseline: true }); f.task(n, 'waiting'); }
  await f.tick(1000);
  f.task(1, 'active');
  await f.tick(4000);
  assert.deepEqual(f.alerts[0].taskIds, [taskId(2)]);
  f.task(3, 'active', { baseline: true }); f.task(3, 'completed');
  f.task(3, 'active', { baseline: true, turnId: 'next-turn' });
  await f.tick(40000);
  assert.equal(f.alerts.filter(alert => alert.kind === 'completed').length, 0);
});

test('低额度恢复或周期重置后不播放已经排队的旧预警', async () => {
  for (const reason of ['recovered', 'reset', 'stale']) {
    const f = fixture();
    await f.companion.setEnabled(true);
    const window = { id: 'codex:primary', label: 'Codex', windowMinutes: 300, remaining: 10,
      resetsAt: reason === 'reset' ? f.time + 2000 : 9000000 };
    f.quota(10, { windows: [window], updatedAt: reason === 'stale' ? f.time - 298000 : f.time });
    if (reason === 'recovered') f.quota(90);
    await f.tick(10000);
    assert.equal(f.alerts.length, 0, reason);
    assert.equal(f.companion.getSnapshot().recent.length, 1);
  }
});

test('断连和移出任务使待播及当前任务提醒失效，但保留历史', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true }); f.task(1, 'waiting'); await f.tick(5000);
  f.callbacks.onStatus({ channel: 'tasks', state: 'disconnected', code: 'DISCONNECTED' });
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  assert.equal(f.companion.getSnapshot().recent.length, 1);
  f.callbacks.onStatus({ channel: 'tasks', state: 'connected' });
  f.task(2, 'active', { baseline: true }); f.task(2, 'waiting');
  f.task(2, 'unknown', { removed: true }); await f.tick(40000);
  assert.equal(f.alerts.length, 1);
});

test('只保留10条近期提醒且显示数据有界', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.setPresent(false);
  for (let n = 0; n < 12; n++) {
    f.task(n, 'active', { baseline: true }); f.task(n, 'completed');
    await f.tick(6000);
  }
  assert.equal(f.companion.getSnapshot().recent.length, 10);
  for (let n = 12; n < 40; n++) f.task(n, 'active', { baseline: true });
  assert.equal(f.companion.getSnapshot().tasks.items.length, 20);
  f.quota(70, { windows: Array.from({ length: 100 }, (_, n) => ({ id: String(n), remaining: 70 })) });
  assert.equal(f.companion.getSnapshot().quota.windows.length, 64);
});

test('手动关闭当前提醒校验id和代次，关闭联动使旧按钮永久无效', async () => {
  const f = fixture();
  assert.equal(f.companion.dismiss(1, 0), false);
  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true }); f.task(1, 'waiting'); await f.tick(5000);
  const current = f.companion.getSnapshot().currentAlert;
  assert.equal(f.companion.dismiss(current.id, current.generation - 1), false);
  assert.equal(f.companion.dismiss(current.id, current.generation), true);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  assert.equal(f.companion.getSnapshot().recent.length, 1);
  await f.companion.setEnabled(false);
  assert.equal(f.companion.dismiss(current.id, current.generation), false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.companion.getSnapshot().recent.length, 0);
});

test('手动刷新失败后仍在旧额度满五分钟时主动通知菜单过期', async () => {
  const f = fixture({ start: (callbacks, index) => {
    callbacks.onAccount({ accountKey: 'account-one' });
    for (const channel of ['quota', 'tasks']) callbacks.onStatus({ channel, state: index ? 'missing' : 'connected', code: index ? 'MISSING' : null });
  } });
  await f.companion.setEnabled(true);
  f.quota(70);
  await f.tick(120000);
  await f.companion.refresh();
  const count = f.changes.length;
  await f.tick(180000);
  assert.equal(f.companion.getSnapshot().quota.stale, true);
  assert.ok(f.changes.length > count);
  assert.equal(f.changes.at(-1).quota.stale, true);
});

test('同档额度排队时继续下降，首次弹出用最新可靠百分比', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.quota(15); await f.tick(1000);
  f.quota(12); await f.tick(4000);
  assert.equal(f.alerts.length, 1);
  assert.match(f.alerts[0].text, /12%/);
  assert.doesNotMatch(f.alerts[0].text, /15%/);
  assert.match(f.companion.getSnapshot().recent[0].text, /12%/);
  f.quota(11);
  assert.match(f.companion.getSnapshot().recent[0].text, /12%/);
});

test('菜单更新回调中关闭联动，不会再发出过期提醒或残留定时器', async () => {
  const f = fixture({ onChange: (value, companion) => { if (value.currentAlert) void companion.setEnabled(false); } });
  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true }); f.task(1, 'waiting');
  await f.tick(5000);
  assert.equal(f.companion.getSnapshot().enabled, false);
  assert.equal(f.alerts.length, 0);
  assert.equal(f.timers.size, 0);
});

test('展示许可检查时关闭联动，返回true也不能继续播放', async () => {
  const f = fixture({ canPresent: companion => { void companion.setEnabled(false); return true; } });
  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true }); f.task(1, 'waiting');
  await f.tick(5000);
  assert.equal(f.alerts.length, 0);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  assert.equal(f.timers.size, 0);
});

test('close先建立终态，清理回调不能重新开启或遗留新连接', async () => {
  let reopenAttempted = false;
  const f = fixture({ onClear: companion => {
    if (!reopenAttempted) { reopenAttempted = true; void companion.setEnabled(true); }
  } });
  await f.companion.setEnabled(true);
  f.quota(10); f.task(1, 'active', { baseline: true }); f.task(1, 'waiting');
  f.companion.close(); await settle();
  assert.equal(reopenAttempted, true);
  assert.equal(f.companion.getSnapshot().enabled, false);
  assert.equal(f.connections.length, 1);
  assert.equal(f.connections[0].closed, true);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.companion.getSnapshot().quota.windows, []);
  assert.deepEqual(f.companion.getSnapshot().tasks.items, []);
  assert.deepEqual(f.companion.getSnapshot().recent, []);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  assert.equal(await f.companion.setEnabled(true), false);
  f.companion.close();
  assert.equal(f.clears.length, 1);
});
