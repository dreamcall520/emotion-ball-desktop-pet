const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.join(__dirname, '../lib/codex-companion.js');
const taskId = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const quotaWindow = (id, windowMinutes, remaining, resetsAt = 9000000, label = `额度 ${id}`) => ({
  id, label, windowMinutes, remaining, resetsAt
});
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
  const alertUpdates = [];
  const changes = [];
  const clears = [];
  const calls = [];
  const companion = createCodexCompanion({
    now: () => time,
    schedule: (callback, delay) => { const id = ++nextTimer; timers.set(id, { at: time + delay, callback }); return id; },
    cancel: id => timers.delete(id),
    canPresent: () => options.canPresent ? options.canPresent(companion) : present,
    onAlert: alert => alerts.push(alert),
    onAlertUpdate: alert => { alertUpdates.push(alert); options.onAlertUpdate?.(alert, companion); },
    onChange: snapshot => { changes.push(snapshot); options.onChange?.(snapshot, companion); },
    onClear: () => { clears.push(time); options.onClear?.(companion); },
    createConnection: callbacks => {
      if (options.createConnection) {
        const connection = { ...options.createConnection(callbacks), callbacks };
        connections.push(connection);
        return connection;
      }
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
    companion, connections, alerts, alertUpdates, changes, clears, calls, timers,
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
  assert.equal(f.alerts[0].motion, 'jelly');
  assert.equal(f.alerts[0].severity, 'urgent');
  assert.equal(f.alerts[0].durationMs, 12000);
  assert.match(f.alerts[0].text, /9%/);
  f.quota(15); await f.tick(30000);
  f.quota(8); await f.tick(30000);
  assert.equal(f.alerts.length, 1);
  assert.equal('recent' in f.companion.getSnapshot(), false);
});

test('额度偏好默认值安全且只部分更新，非法或未提供字段保留原值', async () => {
  const f = fixture();
  assert.equal(f.companion.setPreferences(), false);
  assert.equal(f.companion.setPreferences(null), false);
  assert.equal(f.companion.setPreferences({ quotaAlwaysVisible: 'true', quotaPeriod: 'daily' }), false);
  assert.equal(f.companion.setPreferences({ quotaPeriod: 'fiveHour' }), true);
  assert.equal(f.companion.setPreferences({ quotaPeriod: 'fiveHour' }), false);
  assert.equal(f.companion.setPreferences({ quotaAlwaysVisible: true }), true);
  assert.equal(f.companion.setPreferences({ taskNameInAlerts: true }), true);
  assert.equal(f.companion.setPreferences({ taskNameInAlerts: 1, quotaAlwaysVisible: 0, quotaPeriod: 'weekly-ish' }), false);

  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true, title: '偏好保留' });
  f.task(1, 'completed', { title: '偏好保留' });
  await f.tick(5000);
  assert.match(f.alerts[0].text, /偏好保留/);
});

test('严格按五小时周期提醒，轻强档使用各自动作、样式和展示时长', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.companion.setPreferences({ quotaPeriod: 'fiveHour' });
  f.quota(95, { windows: [
    quotaWindow('codex:primary', 300, 95),
    quotaWindow('gpt-reserve:secondary', 10080, 95)
  ] });
  f.quota(59, { windows: [
    quotaWindow('codex:primary', 300, 59),
    quotaWindow('gpt-reserve:secondary', 10080, 5, 9000000, 'SECRET_WEEK')
  ] });
  await f.tick(5000);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.alerts[0].severity, 'normal');
  assert.equal(f.alerts[0].motion, 'bow');
  assert.equal(f.alerts[0].durationMs, 6000);
  assert.match(f.alerts[0].text, /41%|59%/);
  assert.equal(JSON.stringify(f.alerts[0]).includes('SECRET_WEEK'), false);
  assert.equal(f.companion.getSnapshot().currentAlert.expiresAt, f.time + 6000);

  f.quota(19, { windows: [
    quotaWindow('codex:primary', 300, 19),
    quotaWindow('gpt-reserve:secondary', 10080, 5)
  ] });
  await f.tick(30000);
  assert.equal(f.alerts.length, 2);
  assert.equal(f.alerts[1].severity, 'strong');
  assert.equal(f.alerts[1].motion, 'jelly');
  assert.equal(f.alerts[1].durationMs, 12000);
});

test('首次与新周期普通用量只建基线，首次高用量只提示最高档', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.quota(65, { windows: [quotaWindow('codex:normal', 300, 65)] });
  await f.tick(10000);
  assert.equal(f.alerts.length, 0);
  f.quota(10, { windows: [quotaWindow('codex:high', 300, 10)] });
  await f.tick(5000);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.alerts[0].severity, 'urgent');
  assert.match(f.alerts[0].text, /10%/);
  f.quota(0, { windows: [quotaWindow('codex:full', 300, 0)] });
  await f.tick(30000);
  assert.equal(f.alerts.length, 2);
  assert.match(f.alerts[1].text, /已用完/);
  assert.doesNotMatch(f.alerts[1].text, /90% 档/);
});

test('五秒内多项额度只合并一次，取最高严重度和最低实际剩余且不冒充总余额', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  const baseline = [quotaWindow('codex:primary', 300, 95), quotaWindow('gpt-reserve:secondary', 10080, 95)];
  f.quota(95, { windows: baseline });
  f.quota(69, { windows: [quotaWindow('codex:primary', 300, 69), quotaWindow('gpt-reserve:secondary', 10080, 95)] });
  await f.tick(4000);
  f.quota(8, { windows: [quotaWindow('codex:primary', 300, 69), quotaWindow('gpt-reserve:secondary', 10080, 8)] });
  await f.tick(1000);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.alerts[0].severity, 'urgent');
  assert.equal(f.alerts[0].durationMs, 12000);
  assert.match(f.alerts[0].text, /多项额度/);
  assert.match(f.alerts[0].text, /8%/);
  assert.match(f.alerts[0].text, /非账户总余额/);
});

test('当前多项额度部分失效时立即更新文案和强弱表现，并缩短而不延长截止时间', async () => {
  for (const reason of ['recovered', 'period', 'always-visible']) {
    const f = fixture();
    await f.companion.setEnabled(true);
    const normal = quotaWindow('codex:primary', 300, 69);
    const urgent = quotaWindow('gpt-reserve:secondary', 10080, 10);
    f.quota(95, { windows: [{ ...normal, remaining: 95 }, { ...urgent, remaining: 95 }] });
    f.quota(10, { windows: [normal, urgent] });
    await f.tick(5000);
    const originalExpiry = f.companion.getSnapshot().currentAlert.expiresAt;
    assert.equal(f.companion.getSnapshot().currentAlert.severity, 'urgent');
    assert.match(f.companion.getSnapshot().currentAlert.text, /多项额度/);

    if (reason === 'recovered') {
      f.quota(95, { windows: [normal, { ...urgent, remaining: 95 }] });
    } else if (reason === 'period') {
      f.companion.setPreferences({ quotaPeriod: 'fiveHour' });
    } else {
      f.companion.setPreferences({ quotaAlwaysVisible: true });
    }

    assert.equal(f.alertUpdates.length, 1, reason);
    const update = f.alertUpdates[0];
    assert.doesNotMatch(update.text, /多项额度/);
    if (reason === 'always-visible') {
      assert.equal(update.severity, 'urgent');
      assert.equal(update.motion, 'jelly');
      assert.equal(update.durationMs, 12000);
      assert.equal(update.expiresAt, originalExpiry);
    } else {
      assert.equal(update.severity, 'normal');
      assert.equal(update.motion, 'bow');
      assert.equal(update.durationMs, 6000);
      assert.equal(update.expiresAt, f.time + 6000);
      assert.ok(update.expiresAt < originalExpiry);
    }
    f.companion.close();
  }
});

test('当前额度按最早重置时刻降级并继续等待下一到期点', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  const firstReset = f.time + 10000;
  const secondReset = f.time + 15000;
  const first = quotaWindow('codex:primary', 300, 10, firstReset);
  const second = quotaWindow('gpt-reserve:secondary', 10080, 10, secondReset);
  f.quota(95, { windows: [{ ...first, remaining: 95 }, { ...second, remaining: 95 }] });
  f.quota(10, { windows: [first, second] });
  await f.tick(5000);
  assert.equal(f.companion.getSnapshot().currentAlert.severity, 'urgent');
  await f.tick(4999);
  assert.equal(f.alertUpdates.length, 0);
  await f.tick(1);
  assert.equal(f.alertUpdates.length, 1);
  assert.doesNotMatch(f.alertUpdates[0].text, /多项额度/);
  assert.equal(f.alertUpdates[0].severity, 'urgent');
  assert.notEqual(f.companion.getSnapshot().currentAlert, null);
  await f.tick(4999);
  assert.notEqual(f.companion.getSnapshot().currentAlert, null);
  await f.tick(1);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  assert.equal(f.clears.length, 1);
});

test('单项强额度展示后五秒重置时立即清除，不等十二秒展示期结束', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  const resetsAt = f.time + 10000;
  f.quota(95, { windows: [quotaWindow('codex', 300, 95, resetsAt)] });
  f.quota(10, { windows: [quotaWindow('codex', 300, 10, resetsAt)] });
  await f.tick(5000);
  assert.equal(f.companion.getSnapshot().currentAlert.durationMs, 12000);
  await f.tick(4999);
  assert.notEqual(f.companion.getSnapshot().currentAlert, null);
  await f.tick(1);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  assert.equal(f.clears.length, 1);
});

test('排队额度在五秒合并窗口内重置时立即丢弃，不过期补播', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  const resetsAt = f.time + 4000;
  f.quota(95, { windows: [quotaWindow('codex', 300, 95, resetsAt)] });
  f.quota(10, { windows: [quotaWindow('codex', 300, 10, resetsAt)] });
  assert.ok([...f.timers.values()].some(timer => timer.at === resetsAt));
  await f.tick(4000);
  assert.equal(f.alerts.length, 0);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  await f.tick(10000);
  assert.equal(f.alerts.length, 0);
});

test('额度更新或到期回调内关闭控制器后不留定时器或过期状态', async () => {
  const updated = fixture({ onAlertUpdate: (_alert, companion) => companion.close() });
  await updated.companion.setEnabled(true);
  const normal = quotaWindow('codex:primary', 300, 69);
  const urgent = quotaWindow('gpt-reserve:secondary', 10080, 10);
  updated.quota(95, { windows: [{ ...normal, remaining: 95 }, { ...urgent, remaining: 95 }] });
  updated.quota(10, { windows: [normal, urgent] });
  await updated.tick(5000);
  updated.quota(95, { windows: [normal, { ...urgent, remaining: 95 }] });
  assert.equal(updated.companion.getSnapshot().enabled, false);
  assert.equal(updated.timers.size, 0);
  assert.equal(updated.companion.getSnapshot().currentAlert, null);

  const cleared = fixture({ onClear: companion => companion.close() });
  await cleared.companion.setEnabled(true);
  const resetsAt = cleared.time + 10000;
  cleared.quota(95, { windows: [quotaWindow('codex', 300, 95, resetsAt)] });
  cleared.quota(10, { windows: [quotaWindow('codex', 300, 10, resetsAt)] });
  await cleared.tick(10000);
  assert.equal(cleared.companion.getSnapshot().enabled, false);
  assert.equal(cleared.timers.size, 0);
  assert.equal(cleared.companion.getSnapshot().currentAlert, null);
});

test('手动周期不存在、数据过期和重置等待时都不提醒', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.companion.setPreferences({ quotaPeriod: 'weekly' });
  f.quota(5, { windows: [quotaWindow('five', 300, 5)] });
  f.quota(5, { windows: [quotaWindow('week', 10080, 5)], updatedAt: f.time - 300001 });
  f.quota(0, { windows: [quotaWindow('week', 10080, 0, f.time)] });
  await f.tick(30000);
  assert.equal(f.alerts.length, 0);
});

test('普通额度排队期间跨入强档只升级同一引用，不留两条', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true });
  f.task(1, 'waiting');
  await f.tick(5000);
  f.quota(95);
  f.quota(69);
  await f.tick(6000);
  f.quota(19);
  await f.tick(24000);
  assert.equal(f.alerts.length, 2);
  assert.equal(f.alerts[0].kind, 'waiting');
  assert.equal(f.alerts[1].kind, 'quota');
  assert.equal(f.alerts[1].severity, 'strong');
  await f.tick(30000);
  assert.equal(f.alerts.filter(alert => alert.kind === 'quota').length, 1);
});

test('切换额度周期只清理新范围外额度，任务不动并为新范围建基线', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.companion.setPreferences({ quotaPeriod: 'fiveHour' });
  f.quota(95, { windows: [quotaWindow('codex:primary', 300, 95), quotaWindow('gpt-reserve:secondary', 10080, 10)] });
  f.quota(69, { windows: [quotaWindow('codex:primary', 300, 69), quotaWindow('gpt-reserve:secondary', 10080, 10)] });
  f.task(1, 'active', { baseline: true });
  f.task(1, 'waiting');
  assert.equal(f.companion.setPreferences({ quotaPeriod: 'weekly' }), true);
  await f.tick(5000);
  assert.deepEqual(f.alerts.map(alert => alert.kind), ['waiting']);
  await f.tick(30000);
  assert.deepEqual(f.alerts.map(alert => alert.kind), ['waiting', 'quota']);
  assert.equal(f.alerts[1].severity, 'urgent');
  assert.match(f.alerts[1].text, /10%/);
  await f.tick(30000);
  assert.equal(f.alerts.filter(alert => alert.kind === 'quota').length, 1);
});

test('切换周期时已在展示且仍属于新范围的强额度不重复排队', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.quota(95, { windows: [quotaWindow('gpt-reserve:secondary', 10080, 95)] });
  f.quota(10, { windows: [quotaWindow('gpt-reserve:secondary', 10080, 10)] });
  await f.tick(5000);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.companion.getSnapshot().currentAlert.severity, 'urgent');
  f.companion.setPreferences({ quotaPeriod: 'weekly' });
  await f.tick(60000);
  assert.equal(f.alerts.length, 1);
});

test('打开常驻取消普通额度但保留强额度和任务，关闭时不补报普通历史', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.quota(95);
  f.quota(69);
  assert.equal(f.companion.setPreferences({ quotaAlwaysVisible: true }), true);
  f.task(1, 'active', { baseline: true });
  f.task(1, 'waiting');
  await f.tick(5000);
  assert.deepEqual(f.alerts.map(alert => alert.kind), ['waiting']);

  f.quota(19);
  await f.tick(30000);
  assert.equal(f.alerts[1].kind, 'quota');
  assert.equal(f.alerts[1].severity, 'strong');
  assert.equal(f.companion.setPreferences({ quotaAlwaysVisible: false }), true);
  f.quota(19);
  await f.tick(30000);
  assert.equal(f.alerts.length, 2);
  f.quota(9);
  await f.tick(5000);
  assert.equal(f.alerts.length, 3);
  assert.equal(f.alerts[2].severity, 'urgent');
});

test('从常驻切回临时提醒时用当前值建普通基线，只提醒之后的新档', async () => {
  const f = fixture();
  f.companion.setPreferences({ quotaAlwaysVisible: true });
  await f.companion.setEnabled(true);
  f.quota(95);
  f.quota(69);
  f.companion.setPreferences({ quotaAlwaysVisible: false });
  await f.tick(10000);
  assert.equal(f.alerts.length, 0);
  f.quota(59);
  await f.tick(5000);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.alerts[0].severity, 'normal');
});

test('断连恢复和同账号手动刷新保留去重，恢复时不补普通历史', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.quota(95);
  f.callbacks.onStatus({ channel: 'quota', state: 'disconnected', code: 'DISCONNECTED' });
  f.callbacks.onStatus({ channel: 'quota', state: 'connected', code: null });
  f.quota(59);
  await f.tick(10000);
  assert.equal(f.alerts.length, 0);
  f.quota(49);
  await f.tick(5000);
  assert.equal(f.alerts.length, 1);
  await f.companion.refresh();
  f.quota(49);
  await f.tick(30000);
  assert.equal(f.alerts.length, 1);
});

test('恢复可靠数据时首次已达强档只提示当前最高档', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.quota(95);
  f.callbacks.onStatus({ channel: 'quota', state: 'disconnected', code: 'DISCONNECTED' });
  f.callbacks.onStatus({ channel: 'quota', state: 'connected', code: null });
  f.quota(9);
  await f.tick(5000);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.alerts[0].severity, 'urgent');
  assert.match(f.alerts[0].text, /9%/);
});

test('直接收到已过期或未来时间快照后，恢复可靠值不补报期间普通档', async () => {
  for (const updatedAt of [value => value - 300001, value => value + 1]) {
    const f = fixture();
    await f.companion.setEnabled(true);
    f.quota(95);
    f.quota(59, { updatedAt: updatedAt(f.time) });
    f.quota(59);
    await f.tick(10000);
    assert.equal(f.alerts.length, 0);
    f.quota(49);
    await f.tick(5000);
    assert.equal(f.alerts.length, 1);
    f.companion.close();
  }
});

test('额度引用按 id、周期和重置时刻严格校验，回升、过期或换周期即删除', async () => {
  for (const reason of ['identity', 'recovered', 'expired', 'period']) {
    const f = fixture();
    await f.companion.setEnabled(true);
    f.quota(95);
    f.quota(69);
    if (reason === 'identity') f.quota(69, { windows: [quotaWindow('codex:primary', 300, 69, 10000000)] });
    if (reason === 'recovered') f.quota(95);
    if (reason === 'expired') f.quota(69, { windows: [quotaWindow('codex:primary', 300, 69, f.time)] });
    if (reason === 'period') f.companion.setPreferences({ quotaPeriod: 'weekly' });
    await f.tick(10000);
    assert.equal(f.alerts.length, 0, reason);
    f.companion.close();
  }
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
    { id: 'gpt-reserve:primary', label: 'gpt-reserve', windowMinutes: 300, remaining: 18, resetsAt: 9000000 }
  ] });
  await f.tick(30000);
  assert.equal(f.alerts.length, 3);
  assert.match(f.alerts[2].text, /多项额度/);
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
  assert.equal('recent' in f.companion.getSnapshot(), false);
});

test('同账号重建连接保留额度去重，关闭重开后可再提醒', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.quota(10); await f.tick(5000);
  const old = f.companion.getSnapshot().currentAlert;
  await f.companion.refresh();
  assert.equal('recent' in f.companion.getSnapshot(), false);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  assert.equal(f.companion.dismiss(old.id, old.generation), false);
  f.quota(10); await f.tick(30000);
  assert.equal(f.alerts.length, 1);
  await f.companion.setEnabled(false);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  await f.companion.setEnabled(true);
  f.quota(10); await f.tick(5000);
  assert.equal(f.alerts.length, 2);
});

test('切换账号清空额度提醒基线、当前提示及排队，新账号数据仍接收', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.quota(10);
  f.callbacks.onAccount({ accountKey: 'account-two' });
  assert.equal('recent' in f.companion.getSnapshot(), false);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
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
    assert.equal(f.alerts[0].severity, 'normal');
    assert.equal(f.alerts[0].durationMs, 8000);
    assert.equal(f.alerts[0].text === null, state === 'active');
    assert.deepEqual(f.alerts[0].taskIds, [taskId(1)]);
    assert.equal(JSON.stringify(f.alerts[0]).includes('任务 1'), false);
    f.companion.close();
  }
});

test('完成提醒默认隐藏任务名称和正文，快照只保留纯标题', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true, title: 'SECRET_TITLE', body: 'SECRET_BODY' });
  f.task(1, 'completed', { title: 'SECRET_TITLE', body: 'SECRET_BODY' });
  await f.tick(5000);
  const snapshot = f.companion.getSnapshot();
  assert.equal(f.alerts[0].text, '这轮有结果啦，去看看？');
  assert.equal(JSON.stringify(f.alerts).includes('SECRET_TITLE'), false);
  assert.equal(JSON.stringify(f.alerts).includes('SECRET_BODY'), false);
  assert.equal(JSON.stringify(snapshot.currentAlert).includes('SECRET_TITLE'), false);
  assert.equal(JSON.stringify(snapshot.currentAlert).includes('SECRET_BODY'), false);
  assert.equal(snapshot.tasks.items[0].title, 'SECRET_TITLE');
  assert.equal('body' in snapshot.tasks.items[0], false);
  assert.equal('recent' in snapshot, false);
});

test('任务名称偏好只接受布尔值，非法值保留且变化时立即更新当前完成提醒', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true, title: '\u202e  额度\n标签开发  ' });
  f.task(1, 'completed', { title: '\u202e  额度\n标签开发  ', body: 'SECRET_BODY' });
  await f.tick(5000);
  assert.equal(f.companion.getSnapshot().currentAlert.text, '这轮有结果啦，去看看？');

  const changesBefore = f.changes.length;
  assert.equal(f.companion.setPreferences({ taskNameInAlerts: true }), true);
  assert.equal(f.changes.length, changesBefore + 1);
  assert.equal(f.alertUpdates.at(-1).text, '《额度 标签开发》有结果啦\n去看看？');
  assert.equal(f.companion.getSnapshot().currentAlert.text, '《额度 标签开发》有结果啦\n去看看？');
  assert.equal(JSON.stringify(f.alertUpdates).includes('SECRET_BODY'), false);

  assert.equal(f.companion.setPreferences({ taskNameInAlerts: true }), false);
  assert.equal(f.companion.setPreferences({ taskNameInAlerts: 1 }), false);
  assert.equal(f.alertUpdates.at(-1).text, '《额度 标签开发》有结果啦\n去看看？');
  const updates = f.alertUpdates.length;
  const changes = f.changes.length;
  assert.equal(f.companion.setPreferences({ taskNameInAlerts: 'true' }), false);
  assert.equal(f.alertUpdates.length, updates);
  assert.equal(f.changes.length, changes);
  assert.equal(f.companion.setPreferences({ taskNameInAlerts: false }), true);
  assert.equal(f.alertUpdates.at(-1).text, '这轮有结果啦，去看看？');
});

test('开启名称后完成提醒使用最新清理标题，不信任旧引用或正文', async () => {
  const f = fixture();
  assert.equal(f.companion.setPreferences({ taskNameInAlerts: true }), true);
  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true, title: '旧标题' });
  f.task(1, 'completed', { title: '旧标题', body: 'SECRET_BODY' });
  f.task(1, 'completed', { title: '\u202e  最新\n可信标题  ', body: 'SECRET_BODY' });
  await f.tick(5000);
  assert.equal(f.alerts[0].text, '《最新 可信标题》有结果啦\n去看看？');
  assert.doesNotMatch(f.alerts[0].text, /旧标题|SECRET_BODY/);
  assert.equal(JSON.stringify(f.alerts[0]).includes('SECRET_BODY'), false);
});

test('合并完成提醒按仍有效任务数和最新标题生成', async () => {
  const f = fixture();
  f.companion.setPreferences({ taskNameInAlerts: true });
  await f.companion.setEnabled(true);
  for (const n of [1, 2]) {
    f.task(n, 'active', { baseline: true, title: `旧任务 ${n}` });
    f.task(n, 'completed', { title: `旧任务 ${n}` });
  }
  f.task(1, 'unknown', { title: '已失效任务' });
  f.task(2, 'completed', { title: '最新任务 2' });
  await f.tick(5000);
  assert.deepEqual(f.alerts[0].taskIds, [taskId(2)]);
  assert.equal(f.alerts[0].text, '《最新任务 2》有结果啦\n去看看？');
  assert.doesNotMatch(f.alerts[0].text, /已失效|旧任务|2 个/);
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

test('同轮运行或等待经过短暂idle后，真实完成或失败仍提醒且只提醒一次', async () => {
  for (const before of ['active', 'waiting']) {
    for (const terminal of ['completed', 'failed']) {
      const f = fixture();
      await f.companion.setEnabled(true);
      f.task(1, before, { baseline: true });
      f.task(1, 'idle');
      await f.tick(150);
      assert.equal(f.alerts.length, 0, 'idle本身不生成提醒');
      f.task(1, terminal);
      await f.tick(5000);
      assert.deepEqual(f.alerts.map(alert => alert.kind), [terminal], `${before} -> idle -> ${terminal}`);
      f.task(1, 'active', { baseline: true });
      f.task(1, 'idle'); f.task(1, terminal);
      await f.tick(30000);
      assert.equal(f.alerts.length, 1, '相同轮次不重复');
      f.companion.close();
    }
  }
});

test('idle过渡只保留五秒，重复idle不续期；没有明确终态不提醒', async () => {
  for (const delay of [4999, 5000, 15000]) {
    const f = fixture();
    await f.companion.setEnabled(true);
    f.task(1, 'active', { baseline: true }); f.task(1, 'idle');
    await f.tick(3000); f.task(1, 'idle');
    await f.tick(delay - 3000);
    assert.equal(f.alerts.length, 0);
    f.task(1, 'completed'); await f.tick(5000);
    assert.equal(f.alerts.length, delay < 5000 ? 1 : 0, `idle持续${delay}毫秒`);
    f.companion.close();
  }
});

test('idle过渡不跨越基线、未知、换轮次或中断，也不补报历史idle完成', async () => {
  for (const reason of ['historical', 'idle-baseline', 'terminal-baseline', 'unknown', 'new-turn', 'interrupted']) {
    const f = fixture();
    await f.companion.setEnabled(true);
    if (reason !== 'historical') f.task(1, 'active', { baseline: true });
    f.task(1, 'idle', { baseline: reason === 'historical' || reason === 'idle-baseline' });
    if (reason === 'unknown' || reason === 'interrupted') f.task(1, reason);
    if (reason === 'new-turn') f.task(1, 'idle', { turnId: 'different-turn' });
    f.task(1, 'completed', { baseline: reason === 'terminal-baseline' });
    await f.tick(5000);
    assert.equal(f.alerts.length, 0, reason);
    f.companion.close();
  }
});

test('idle过渡在断连、移除、刷新、换账号、开关和任务淘汰后立即失效', async () => {
  for (const reason of ['disconnected', 'removed', 'refresh', 'account', 'disable', 'eviction']) {
    const f = fixture();
    await f.companion.setEnabled(true);
    f.task(1, 'active', { baseline: true }); f.task(1, 'idle');
    if (reason === 'disconnected') {
      f.callbacks.onStatus({ channel: 'tasks', state: 'disconnected', code: 'DISCONNECTED' });
      f.callbacks.onStatus({ channel: 'tasks', state: 'connected' });
    } else if (reason === 'removed') f.task(1, 'unknown', { removed: true });
    else if (reason === 'refresh') await f.companion.refresh();
    else if (reason === 'account') f.callbacks.onAccount({ accountKey: 'account-two' });
    else if (reason === 'disable') {
      await f.companion.setEnabled(false); await f.companion.setEnabled(true);
    } else for (let n = 2; n <= 65; n++) f.task(n, 'idle', { baseline: true });
    f.task(1, 'idle'); f.task(1, 'completed');
    await f.tick(5000);
    assert.equal(f.alerts.length, 0, reason);
    f.companion.close();
  }
});

test('两条任务各自经过idle后完成仍按五秒窗口合并', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  for (const n of [1, 2]) {
    f.task(n, 'active', { baseline: true }); f.task(n, 'idle');
    await f.tick(100); f.task(n, 'completed');
    await f.tick(1000);
  }
  await f.tick(5000);
  assert.equal(f.alerts.length, 1);
  assert.deepEqual(f.alerts[0].taskIds, [taskId(1), taskId(2)]);
  assert.equal(f.alerts[0].kind, 'completed');
  f.companion.close();
});

test('清理提醒回调重建基线或连接时，旧idle处理不恢复过渡证据', async () => {
  for (const reason of ['baseline', 'account', 'disable', 'refresh']) {
    let replaced = false;
    const f = fixture({ onClear(companion) {
      if (replaced) return;
      replaced = true;
      if (reason === 'account') f.callbacks.onAccount({ accountKey: 'account-two' });
      else if (reason === 'disable') { void companion.setEnabled(false); void companion.setEnabled(true); }
      else if (reason === 'refresh') void companion.refresh();
      f.task(1, 'idle', { baseline: true });
    } });
    await f.companion.setEnabled(true);
    f.task(1, 'idle', { baseline: true }); f.task(1, 'active');
    await f.tick(5000);
    assert.deepEqual(f.alerts.map(alert => alert.kind), ['active']);
    f.task(1, 'idle');
    await settle();
    assert.equal(replaced, true);
    f.task(1, 'completed'); await f.tick(30000);
    assert.deepEqual(f.alerts.map(alert => alert.kind), ['active'], reason);
    f.companion.close();
  }
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

test('五秒内同类任务合并，默认气泡不包含任务标题和正文', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true }); f.task(1, 'waiting', { title: 'SECRET_TITLE', body: 'SECRET_BODY' });
  await f.tick(4000);
  f.task(2, 'active', { baseline: true }); f.task(2, 'waiting');
  await f.tick(1000);
  assert.equal(f.alerts.length, 1);
  assert.deepEqual(f.alerts[0].taskIds, [taskId(1), taskId(2)]);
  assert.equal(JSON.stringify(f.alerts).includes('SECRET'), false);
  assert.equal(JSON.stringify(f.companion.getSnapshot().currentAlert).includes('SECRET'), false);
  assert.equal('recent' in f.companion.getSnapshot(), false);
});

test('忙碌/睡眠时延后，60秒过期后仅留任务快照，不补播', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.setPresent(false);
  f.task(1, 'active', { baseline: true }); f.task(1, 'waiting');
  await f.tick(60000);
  f.setPresent(true); await f.tick(10000);
  assert.equal(f.alerts.length, 0);
  assert.equal('recent' in f.companion.getSnapshot(), false);
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
    assert.equal('recent' in f.companion.getSnapshot(), false);
  }
});

test('断连使待播及当前任务提醒失效', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true }); f.task(1, 'waiting'); await f.tick(5000);
  f.callbacks.onStatus({ channel: 'tasks', state: 'disconnected', code: 'DISCONNECTED' });
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  assert.equal('recent' in f.companion.getSnapshot(), false);
  f.callbacks.onStatus({ channel: 'tasks', state: 'connected' });
  f.task(2, 'active', { baseline: true }); f.task(2, 'waiting');
  f.callbacks.onStatus({ channel: 'tasks', state: 'disconnected', code: 'DISCONNECTED' });
  await f.tick(40000);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
});

test('不保留历史提醒，任务快照最多64条且额度数据有界', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.setPresent(false);
  for (let n = 0; n < 12; n++) {
    f.task(n, 'active', { baseline: true }); f.task(n, 'completed');
    await f.tick(6000);
  }
  assert.equal('recent' in f.companion.getSnapshot(), false);
  for (let n = 12; n < 76; n++) f.task(n, 'active', { baseline: true });
  assert.equal(f.companion.getSnapshot().tasks.items.length, 64);
  assert.equal(f.companion.getSnapshot().tasks.items[0].id, taskId(12));
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
  assert.equal('recent' in f.companion.getSnapshot(), false);
  await f.companion.setEnabled(false);
  assert.equal(f.companion.dismiss(current.id, current.generation), false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
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
  f.quota(11);
  assert.match(f.alerts[0].text, /12%/);
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
  assert.equal('recent' in f.companion.getSnapshot(), false);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  assert.equal(await f.companion.setEnabled(true), false);
  f.companion.close();
  assert.equal(f.clears.length, 1);
});

test('许可回调把等待任务改成完成后，不播放空任务的旧等待提醒', async () => {
  let changed = false;
  const f = fixture({ canPresent: () => {
    if (!changed) { changed = true; f.task(1, 'completed'); }
    return true;
  } });
  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true }); f.task(1, 'waiting');
  await f.tick(5000);
  assert.equal(f.alerts.length, 0);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  await f.tick(5000);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.alerts[0].kind, 'completed');
  assert.deepEqual(f.alerts[0].taskIds, [taskId(1)]);
});

test('许可回调恢复额度后，已移出队列的旧额度提醒不再显示', async () => {
  const f = fixture({ canPresent: () => { f.quota(90); return true; } });
  await f.companion.setEnabled(true);
  f.quota(15); await f.tick(5000);
  assert.equal(f.alerts.length, 0);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  assert.equal('recent' in f.companion.getSnapshot(), false);
});

test('许可回调改变合并提醒的同一对象时，只显示仍有效的任务子集', async () => {
  let changed = false;
  const f = fixture({ canPresent: () => {
    if (!changed) { changed = true; f.task(1, 'completed'); }
    return true;
  } });
  await f.companion.setEnabled(true);
  for (const n of [1, 2]) { f.task(n, 'active', { baseline: true }); f.task(n, 'waiting'); }
  await f.tick(5000);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.alerts[0].kind, 'waiting');
  assert.deepEqual(f.alerts[0].taskIds, [taskId(2)]);
  assert.equal(f.alerts[0].text, '有一步等你确认哦');
});

test('许可回调恢复部分额度且同档更新剩余项，采用有效子集最新比例', async () => {
  const windows = [
    { id: 'codex:primary', label: 'Codex', windowMinutes: 300, remaining: 15, resetsAt: 9000000 },
    { id: 'gpt-reserve:primary', label: 'gpt-reserve', windowMinutes: 300, remaining: 18, resetsAt: 9000000 }
  ];
  const f = fixture({ canPresent: () => {
    f.quota(90, { windows: [{ ...windows[0], remaining: 90 }, { ...windows[1], remaining: 12 }] });
    return true;
  } });
  await f.companion.setEnabled(true);
  f.quota(15, { windows }); await f.tick(5000);
  assert.equal(f.alerts.length, 1);
  assert.match(f.alerts[0].text, /12%/);
  assert.doesNotMatch(f.alerts[0].text, /2 项|15%|18%/);
});

test('展示前菜单回调替换任务状态，不再onAlert也不保留当前提醒', async () => {
  let changed = false;
  const f = fixture({ onChange: value => {
    if (value.currentAlert?.kind === 'waiting' && !changed) { changed = true; f.task(1, 'completed'); }
  } });
  await f.companion.setEnabled(true);
  f.task(1, 'active', { baseline: true }); f.task(1, 'waiting'); await f.tick(5000);
  assert.equal(f.alerts.length, 0);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  assert.equal('recent' in f.companion.getSnapshot(), false);
});

test('展示前菜单回调恢复额度，不再onAlert也不保留当前提示', async () => {
  let changed = false;
  const f = fixture({ onChange: value => {
    if (value.currentAlert?.kind === 'quota' && !changed) { changed = true; f.quota(90); }
  } });
  await f.companion.setEnabled(true);
  f.quota(15); await f.tick(5000);
  assert.equal(f.alerts.length, 0);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  assert.equal('recent' in f.companion.getSnapshot(), false);
});

test('展示前菜单回调同档更新额度，onAlert使用最终比例', async () => {
  let changed = false;
  const f = fixture({ onChange: value => {
    if (value.currentAlert?.kind === 'quota' && !changed) { changed = true; f.quota(12); }
  } });
  await f.companion.setEnabled(true);
  f.quota(15); await f.tick(5000);
  assert.equal(f.alerts.length, 1);
  assert.match(f.alerts[0].text, /12%/);
  assert.equal('recent' in f.companion.getSnapshot(), false);
});

test('手动刷新清理回调重入关闭或重启时，不继续打开旧请求的连接', async () => {
  for (const action of ['close', 'restart']) {
    let armed = false;
    let acted = false;
    let f;
    f = fixture({ onClear: companion => {
      if (!armed || acted) return;
      acted = true;
      if (action === 'close') companion.close();
      else {
        void companion.setEnabled(false);
        void companion.setEnabled(true);
      }
    } });
    await f.companion.setEnabled(true);
    armed = true;

    assert.equal(await f.companion.refresh(), true);
    await settle();
    assert.equal(acted, true, action);
    assert.equal(f.connections.length, action === 'close' ? 1 : 2, action);
    assert.equal(f.connections.some(connection => !connection.closed), action === 'restart', action);
    assert.notEqual(f.companion.getSnapshot().quota.state, 'connecting', action);
    assert.notEqual(f.companion.getSnapshot().tasks.state, 'connecting', action);
    if (action === 'close') {
      assert.equal(f.companion.getSnapshot().enabled, false);
      assert.equal(f.companion.getSnapshot().quota.state, 'disabled');
      assert.equal(f.companion.getSnapshot().tasks.state, 'disabled');
      assert.equal(f.timers.size, 0);
    }
    f.companion.close();
  }
});

test('额度清理回调重入刷新、禁用或换账号后，旧回包不再通知或提醒', async () => {
  for (const action of ['refresh', 'disable']) {
    let armed = false;
    let acted = false;
    let changesAfterAction = -1;
    let f;
    f = fixture({ onAlertUpdate: (_alert, companion) => {
      if (!armed || acted) return;
      acted = true;
      if (action === 'refresh') void companion.refresh();
      else void companion.setEnabled(false);
      changesAfterAction = f.changes.length;
    } });
    await f.companion.setEnabled(true);
    const normal = quotaWindow('codex:primary', 300, 69);
    const urgent = quotaWindow('gpt-reserve:secondary', 10080, 10);
    f.quota(95, { windows: [{ ...normal, remaining: 95 }, { ...urgent, remaining: 95 }] });
    f.quota(10, { windows: [normal, urgent] });
    await f.tick(5000);
    const oldCallbacks = f.callbacks;
    armed = true;

    oldCallbacks.onQuota({
      windows: [{ ...normal, remaining: 59 }, { ...urgent, remaining: 95 }],
      updatedAt: f.time
    });
    await settle();
    assert.equal(acted, true, action);
    assert.equal(f.changes.length, changesAfterAction, action);
    if (action === 'refresh') {
      assert.equal(f.connections.length, 2);
      await f.tick(30000);
      assert.equal(f.alerts.length, 1);
    } else {
      assert.equal(f.companion.getSnapshot().enabled, false);
      assert.equal(f.timers.size, 0);
    }
    f.companion.close();
  }

  let armed = false;
  let acted = false;
  let changesAfterAction = -1;
  let f;
  f = fixture({ onClear: () => {
    if (!armed || acted) return;
    acted = true;
    f.callbacks.onAccount({ accountKey: 'account-two' });
    changesAfterAction = f.changes.length;
  } });
  await f.companion.setEnabled(true);
  f.quota(95);
  f.quota(10);
  await f.tick(5000);
  const oldCallbacks = f.callbacks;
  armed = true;
  oldCallbacks.onQuota({ windows: [quotaWindow('codex:primary', 300, 95)], updatedAt: f.time });
  assert.equal(acted, true);
  assert.equal(f.changes.length, changesAfterAction);
  assert.deepEqual(f.companion.getSnapshot().quota.windows, []);
  f.companion.close();
});

test('排队普通额度在第59秒升为强提醒时，同一事件从升级时重新获得有效期', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.setPresent(false);
  f.quota(95);
  f.quota(69);
  await f.tick(59000);
  f.quota(19);
  f.setPresent(true);

  await f.tick(1000);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.alerts[0].kind, 'quota');
  assert.equal(f.alerts[0].severity, 'strong');
  assert.equal(f.alerts[0].motion, 'jelly');
  await f.tick(60000);
  assert.equal(f.alerts.length, 1);
});

test('排队额度在第59秒从80档升到90档时，该引用独立续期且urgent不丢失', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.setPresent(false);
  f.quota(95);
  f.quota(19);
  await f.tick(59000);
  f.quota(9);
  f.setPresent(true);

  await f.tick(1000);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.alerts[0].severity, 'urgent');
  assert.match(f.alerts[0].text, /9%/);
  assert.equal(JSON.stringify(f.alerts[0]).includes('queueExpiresAt'), false);
});

test('合并额度只续期升档引用，旧普通项到60秒即剔除', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.setPresent(false);
  const first = quotaWindow('codex:primary', 300, 69);
  const upgraded = quotaWindow('gpt-reserve:secondary', 10080, 69);
  f.quota(95, { windows: [{ ...first, remaining: 95 }, { ...upgraded, remaining: 95 }] });
  f.quota(69, { windows: [first, upgraded] });
  await f.tick(59000);
  f.quota(19, { windows: [first, { ...upgraded, remaining: 19 }] });
  await f.tick(58000);
  f.setPresent(true);

  await f.tick(1000);
  assert.equal(f.time, 1118000);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.alerts[0].severity, 'strong');
  assert.doesNotMatch(f.alerts[0].text, /多项额度/);
  assert.match(f.alerts[0].text, /19%/);
  const displayExpiry = f.companion.getSnapshot().currentAlert.expiresAt;
  await f.tick(2000);
  assert.notEqual(f.companion.getSnapshot().currentAlert, null);
  assert.equal(f.companion.getSnapshot().currentAlert.expiresAt, displayExpiry);
});

test('排队额度在第59秒从90档升到100档时，只续期该引用并显示用完', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.setPresent(false);
  f.quota(95);
  f.quota(9);
  await f.tick(59000);
  f.quota(0);
  f.setPresent(true);

  await f.tick(1000);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.alerts[0].severity, 'urgent');
  assert.match(f.alerts[0].text, /已用完/);
});

test('排队额度同档只更新可靠剩余值，不会反复续期', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  f.setPresent(false);
  f.quota(95);
  f.quota(19);
  for (let remaining = 18; remaining >= 14; remaining--) {
    await f.tick(10000);
    f.quota(remaining);
  }
  await f.tick(9000);
  f.quota(13);
  f.setPresent(true);

  await f.tick(2000);
  assert.equal(f.alerts.length, 0);
  assert.equal(f.companion.getSnapshot().currentAlert, null);
});

test('账号清理回调重入禁用或新账号时，旧账号回调不覆盖最终状态', async () => {
  let armed = false;
  let acted = false;
  let f;
  f = fixture({ onClear: companion => {
    if (!armed || acted) return;
    acted = true;
    void companion.setEnabled(false);
  } });
  await f.companion.setEnabled(true);
  armed = true;
  f.callbacks.onAccount({ accountKey: 'account-two' });
  await settle();
  const disabledGeneration = f.companion.getSnapshot().generation;
  const disabledClears = f.clears.length;
  assert.equal(f.companion.getSnapshot().enabled, false);
  await f.companion.setEnabled(true);
  assert.equal(f.companion.getSnapshot().generation, disabledGeneration + 1);
  assert.equal(f.clears.length, disabledClears);
  assert.equal(f.connections.length, 2);
  f.companion.close();

  armed = false;
  acted = false;
  let nested;
  nested = fixture({ onClear: () => {
    if (!armed || acted) return;
    acted = true;
    nested.callbacks.onAccount({ accountKey: 'account-three' });
  } });
  await nested.companion.setEnabled(true);
  armed = true;
  nested.callbacks.onAccount({ accountKey: 'account-two' });
  const clearsAfterNestedAccount = nested.clears.length;
  nested.callbacks.onAccount({ accountKey: 'account-three' });
  assert.equal(nested.clears.length, clearsAfterNestedAccount);
  nested.companion.close();
});

test('额度偏好每个字段只读一次，读取抛错时不改任何偏好', () => {
  const f = fixture();
  const reads = { taskNameInAlerts: 0, quotaAlwaysVisible: 0, quotaPeriod: 0 };
  const stateful = {};
  Object.defineProperties(stateful, {
    taskNameInAlerts: { get() { return ++reads.taskNameInAlerts === 1 ? true : false; } },
    quotaAlwaysVisible: { get() { return ++reads.quotaAlwaysVisible === 1 ? true : false; } },
    quotaPeriod: { get() { return ++reads.quotaPeriod === 1 ? 'weekly' : 'auto'; } }
  });
  assert.equal(f.companion.setPreferences(stateful), true);
  assert.deepEqual(reads, { taskNameInAlerts: 1, quotaAlwaysVisible: 1, quotaPeriod: 1 });
  assert.equal(f.companion.setPreferences({
    taskNameInAlerts: true, quotaAlwaysVisible: true, quotaPeriod: 'weekly'
  }), false);

  const changesBeforeThrow = f.changes.length;
  const throwing = {};
  Object.defineProperties(throwing, {
    taskNameInAlerts: { get() { return false; } },
    quotaAlwaysVisible: { get() { throw new Error('getter failed'); } },
    quotaPeriod: { get() { return 'fiveHour'; } }
  });
  assert.equal(f.companion.setPreferences(throwing), false);
  assert.equal(f.changes.length, changesBeforeThrow);
  assert.equal(f.companion.setPreferences({
    taskNameInAlerts: true, quotaAlwaysVisible: true, quotaPeriod: 'weekly'
  }), false);
});

test('同一额度键重复出现时，跟踪、引用校验和文案统一使用最后一个可靠值', async () => {
  const f = fixture();
  await f.companion.setEnabled(true);
  const first = quotaWindow('codex:duplicate', 300, 95);
  f.quota(95, { windows: [{ ...first }, { ...first }] });
  f.quota(10, { windows: [{ ...first }, { ...first, remaining: 10 }] });
  await f.tick(5000);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.alerts[0].severity, 'urgent');
  assert.match(f.alerts[0].text, /10%/);

  f.quota(95, { windows: [{ ...first, remaining: 9 }, { ...first, remaining: 95 }] });
  assert.equal(f.companion.getSnapshot().currentAlert, null);
  assert.equal(f.clears.length, 1);
});

test('真实连接组合：账号切换后即使connected状态去重，后续额度轮询仍持续', async () => {
  const { createCodexConnection } = require('../lib/codex-connection');
  let accountReads = 0;
  let quotaReads = 0;
  let metadataReads = 0;
  const f = fixture({ createConnection: callbacks => createCodexConnection({
    ...callbacks,
    now: () => f.time,
    createRpc: () => ({
      start: async () => {}, close() {},
      readAccount: async () => ({ accountKey: ++accountReads === 1 ? 'one' : 'two', authenticated: true, supported: true }),
      readQuota: async updatedAt => {
        quotaReads++;
        return { windows: [{ id: 'codex:primary', label: 'Codex', windowMinutes: 300, remaining: 70, resetsAt: 9000000 }], updatedAt };
      },
      listThreads: async () => {
        metadataReads++;
        return [{ id: taskId(1), title: '正在运行的任务', state: 'unknown', turnId: null, updatedAt: f.time, partial: true }];
      }
    }),
    createStream: ({ onTask, onStatus }) => ({
      start: async () => {}, close() {},
      setThreads: rows => {
        for (const row of rows) onTask({ ...row, state: 'active', turnId: 'turn-one', baseline: true });
        onStatus({ state: 'connected', code: null });
      }
    })
  }) });
  await f.companion.setEnabled(true);
  assert.equal(quotaReads, 1);
  assert.equal(f.companion.getSnapshot().quota.state, 'connected');
  await f.tick(120000);
  assert.equal(quotaReads, 2);
  assert.equal(f.companion.getSnapshot().quota.state, 'connected');
  await f.tick(240000);
  assert.equal(quotaReads, 4);
  assert.equal(accountReads, 4);
  assert.ok(metadataReads > 4);
  assert.equal(f.companion.getSnapshot().quota.updatedAt, f.time);
  assert.equal(f.companion.getSnapshot().quota.stale, false);
  assert.equal(f.companion.getSnapshot().tasks.state, 'connected');
  f.companion.close();
  assert.equal(f.timers.size, 0);
});
