const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createQuotaHistory } = require('../lib/codex-quota-history');
const { createCodexCompanion } = require('../lib/codex-companion');
const { normalizeQuota } = require('../lib/codex-state');
const { buildQuotaLabelModel, buildCodexDetailsModel, formatQuotaDate } = require('../lib/codex-quota-view');

const NOW = new Date(2026, 9, 4, 20, 0).getTime();
const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const quotaWindow = (minutes = 300, remaining = 60, resetsAt = NOW + 2 * 3600000) => ({
  id: minutes === 300 ? 'codex:primary' : 'codex:secondary', label: 'Codex',
  windowMinutes: minutes, remaining, resetsAt
});
const snapshot = (time, windows = [quotaWindow()], extra = {}) => ({ enabled: true,
  quota: { state: 'connected', stale: false, updatedAt: time, windows, ...extra },
  tasks: { state: 'connected', items: [] }
});

test('采样只处理已确认账号的启用、新鲜数据；重复观察不产生写盘', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-status-data-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'history.json'); let time = NOW;
  const store = createQuotaHistory({ filePath, now: () => time });
  assert.equal(store.record(snapshot(time)), false);
  store.setAccount('account-a');
  assert.equal(store.record({ ...snapshot(time), enabled: false }), false);
  assert.equal(store.record(snapshot(time, [quotaWindow()], { stale: true })), false);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(store.record(snapshot(time)), true);
  const content = fs.readFileSync(filePath, 'utf8');
  assert.equal(store.record(snapshot(time)), false);
  assert.equal(fs.readFileSync(filePath, 'utf8'), content);
  time += 120000;
  assert.equal(store.record(snapshot(time)), true);
  assert.equal(store.getState().windows[0].samples.length, 2);
  store.close(); assert.equal(store.record(snapshot(time)), false);
});

test('账号隔离、周期换段、余额回升/大跳变和长断档重新采样', () => {
  let time = NOW; const store = createQuotaHistory({ now: () => time }); store.setAccount('a');
  store.record(snapshot(time, [quotaWindow(300, 80)]));
  time += 120000; store.record(snapshot(time, [quotaWindow(300, 78)]));
  assert.equal(store.getState().windows[0].samples.length, 2);
  time += 120000; store.record(snapshot(time, [quotaWindow(300, 90)]));
  assert.deepEqual(store.getState().windows[0].samples, [{ at: time, remaining: 90 }]);
  time += 120000; store.record(snapshot(time, [quotaWindow(300, 40)]));
  assert.equal(store.getState().windows[0].samples.length, 1);
  time += 600000; store.record(snapshot(time, [quotaWindow(300, 39)]));
  assert.equal(store.getState().windows[0].samples.length, 1);
  time += 120000; store.record(snapshot(time, [quotaWindow(300, 80, time + 5 * 3600000)]));
  assert.equal(store.getState().windows.length, 2);
  store.setAccount('b'); assert.deepEqual(store.getState().windows, []);
  store.setAccount('a'); assert.equal(store.getState().windows.length, 2);
  store.setAccount(null); assert.equal(store.getState().available, false);
});

test('5h预测要求连续采样跨度10分钟，stale/不足/跨重置不估计', () => {
  let time = NOW; const store = createQuotaHistory({ now: () => time }); store.setAccount('a');
  let source;
  for (let index = 0; index <= 5; index++) {
    time = NOW + index * 120000; source = snapshot(time, [quotaWindow(300, 90 - index * 2)]);
    store.record(source); source.history = store.getState();
    const trend = buildCodexDetailsModel(source, { action: 'trend' }, time).trend;
    assert.equal(trend.forecast.state, index < 5 ? 'unknown' : 'estimate');
    if (index === 0) assert.equal(trend.forecast.summary, '暂无法预估额度用完时间');
  }
  const forecast = buildCodexDetailsModel(source, {}, time).trend.forecast;
  assert.ok(forecast.exhaustsAt > time && forecast.exhaustsAt < source.quota.windows[0].resetsAt);
  source.quota.stale = true;
  assert.equal(buildCodexDetailsModel(source, {}, time).trend.forecast.state, 'unknown');
  source.quota.stale = false; source.quota.windows[0].resetsAt += 60000;
  assert.deepEqual(buildCodexDetailsModel(source, {}, time).trend.samples, []);
});

test('周周期持续24小时仍能估计，6000上限保留整周，5h换段不挤出当前周', () => {
  let time = NOW; const store = createQuotaHistory({ now: () => time }); store.setAccount('a');
  const reset = NOW + 7 * 86400000; let source;
  for (let index = 0; index <= 721; index++) {
    time = NOW + index * 120000;
    source = snapshot(time, [quotaWindow(10080, 100 - index * 0.04, reset),
      quotaWindow(300, 80, NOW + (Math.floor(index / 150) + 1) * 5 * 3600000)]);
    store.record(source);
    if (index === 719 || index === 720) {
      source.history = store.getState();
      assert.equal(buildCodexDetailsModel(source, { period: 'weekly' }, time).trend.forecast.state,
        index < 720 ? 'unknown' : 'estimate');
    }
  }
  const weekly = store.getState().windows.find(row => row.windowMinutes === 10080);
  assert.equal(weekly.samples.length, 722);
  assert.equal(weekly.samples.at(-1).at - weekly.samples[0].at, 721 * 120000);
});

test('重置数量0与未知、null与空明细、返回部分和真实到期/使用严格区分', () => {
  const raw = credits => normalizeQuota({ rateLimits: { limitId: 'codex', primary: {
    windowDurationMins: 300, usedPercent: 30, resetsAt: (NOW + 3600000) / 1000 } },
  rateLimitResetCredits: credits }, NOW);
  assert.equal('resetCreditsAvailable' in raw(undefined), false);
  assert.equal(raw({ availableCount: 0 }).resetCreditsAvailable, 0);
  assert.equal(raw({ availableCount: 0 }).resetOpportunities, null);
  assert.deepEqual(raw({ availableCount: 0, credits: [] }).resetOpportunities, []);
  const known = raw({ availableCount: 2, credits: [{ id: 'reset-a', title: '套餐重置', status: 'available',
    resetType: 'codexRateLimits', grantedAt: NOW / 1000, expiresAt: null, description: 'SECRET', token: 'SECRET' }] });
  assert.equal(known.resetDetailsPartial, true);
  assert.equal(known.resetOpportunities[0].expiresAt, null);
  assert.equal(JSON.stringify(known).includes('SECRET'), false);
  const source = snapshot(NOW, known.windows, { ...known });
  source.history = { available: true, windows: [], results: [], resetHistory: [] };
  const model = buildCodexDetailsModel(source, { action: 'opportunities' }, NOW);
  assert.equal(model.resetDetailsState, 'known'); assert.equal(model.resetDetailsPartial, true);
  assert.equal(model.resetOpportunities.length, 1); assert.equal(model.resetHistory.length, 0);
  known.resetOpportunities[0].expiresAt = NOW - 1;
  source.quota = { ...source.quota, ...known };
  assert.equal(buildCodexDetailsModel(source, {}, NOW).resetHistory[0].state, 'expired');
});

test('账户事件不混入本机终态缓存，未同步和禁用不冒充账户历史0', () => {
  const source = snapshot(NOW, [quotaWindow()], {accountResetHistory:{state:'ready',updatedAt:NOW,events:[
    {id:'event-a',kind:'granted',occurredAt:NOW-3600000,token:'SECRET'},
    {id:'event-b',kind:'redeemed',occurredAt:NOW-600000}],authToken:'SECRET'}});
  source.history = {available:true,resetHistory:[{id:'local-expiry',status:'available',grantedAt:NOW-86400000,expiresAt:NOW-1000}],windows:[],results:[]};
  const model = buildCodexDetailsModel(source,{action:'opportunities'},NOW);
  assert.equal(model.accountResetHistory.state,'ready'); assert.equal(model.accountResetHistory.events.length,2);
  assert.equal(model.resetHistory.length,1); assert.equal(model.resetHistory[0].state,'expired');
  assert.equal(JSON.stringify(model).includes('SECRET'),false);
  source.quota.stale = true;
  assert.equal(buildCodexDetailsModel(source,{},NOW).accountResetHistory.state,'error');
  source.enabled = false;
  const disabled = buildCodexDetailsModel(source,{},NOW).accountResetHistory;
  assert.equal(disabled.state,'unavailable'); assert.deepEqual(disabled.events,[]);
});

test('可信采样可区分较充裕、刚够和早于重置，不把能撑到重置当记录不足', () => {
  const time = NOW + 10 * 60000; const reset = time + 20 * 60000;
  for (const [lastRemaining, consumed, expected] of [[40, 10, 'safe'], [25, 10, 'tight'], [15, 10, 'risk'], [40, 0, 'safe']]) {
    const source = snapshot(time, [quotaWindow(300, lastRemaining, reset)]);
    source.history = { available: true, results: [], windows: [{ ...source.quota.windows[0],
      samples: Array.from({ length: 6 }, (_, index) => ({ at: NOW + index * 120000,
        remaining: lastRemaining + consumed - consumed * index / 5 })) }] };
    const forecast = buildCodexDetailsModel(source, {}, time).trend.forecast;
    assert.equal(forecast.state, 'estimate'); assert.equal(forecast.status, expected);
    assert.ok(forecast.summary && forecast.detail);
    if (!consumed) assert.equal(forecast.exhaustsAt, null);
  }
});

test('详情数字周期选择保留真实双周期并绘制所选周期，不误用5小时记录', () => {
  const source = snapshot(NOW, [quotaWindow(), quotaWindow(10080, 70, NOW + 3 * 86400000)]);
  source.history = { available: true, windows: [], results: [] };
  const model = buildCodexDetailsModel(source, { period: 10080 }, NOW);
  assert.equal(model.items.length, 2); assert.equal(model.period, 10080);
  assert.equal(model.trend.windowMinutes, 10080);
  assert.equal(buildCodexDetailsModel(source, { period: 'weekly' }, NOW).period, 10080);
});

test('持久化最多四个账号，写盘失败只报告固定错误码，不阻断观察', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-status-bounds-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let time = NOW; const filePath = path.join(directory, 'history.json');
  const store = createQuotaHistory({ filePath, now: () => time });
  for (let index = 0; index < 5; index++) {
    store.setAccount(`account-${index}`); store.record(snapshot(time)); time += 120000;
  }
  const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(Object.keys(saved.accounts).length, 4);
  assert.equal(JSON.stringify(saved).includes('account-'), false);
  const errors = [];
  const blocked = createQuotaHistory({ filePath: path.join(filePath, 'impossible.json'), now: () => time,
    onError: code => { errors.push(code); throw new Error('Callback may not break quota'); } });
  blocked.setAccount('a'); assert.equal(blocked.record(snapshot(time)), true);
  assert.ok(errors.includes('HISTORY_WRITE_FAILED')); assert.equal(blocked.getState().windows.length, 1);
});

test('仅新观察的终态加入待查看；启动历史不加入，打开后标读不删任务且读态可恢复', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-status-results-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'history.json'); let callbacks; let time = NOW;
  const history = createQuotaHistory({ filePath, now: () => time });
  const companion = createCodexCompanion({ history, now: () => time,
    createConnection(value) { callbacks = value; return { start() {
      callbacks.onAccount({ accountKey: 'a' }); callbacks.onStatus({ channel: 'tasks', state: 'connected' });
    }, close() {}, refresh() {}, retry() {} }; } });
  t.after(() => companion.close()); await companion.setEnabled(true);
  const send = (id, state, baseline = false, turnId = 'turn-a') => callbacks.onTask({ id, title: '开发任务',
    state, baseline, turnId, updatedAt: time });
  send(ID, 'completed', true); assert.equal(companion.getSnapshot().history.results.length, 0);
  send(ID2, 'active', true); time += 1000; send(ID2, 'completed');
  assert.equal(buildQuotaLabelModel(companion.getSnapshot(), {}, time).activity.unreadCount, 1);
  assert.equal(companion.markRead(ID2, 'wrong-turn'), false);
  assert.equal(companion.markRead(ID2, 'turn-a'), true);
  assert.equal(companion.getSnapshot().tasks.items.length, 2);
  assert.equal(buildQuotaLabelModel(companion.getSnapshot(), {}, time).activity.unreadCount, 0);
  send(ID2, 'completed'); assert.equal(companion.getSnapshot().history.results.length, 1);
  const loaded = createQuotaHistory({ filePath, now: () => time }); loaded.setAccount('a');
  assert.equal(loaded.getState().results[0].readAt, time);
  callbacks.onAccount({ accountKey: 'b' }); assert.equal(companion.getSnapshot().history.results.length, 0);
  assert.equal(companion.markRead(ID2, 'turn-a'), false);
  await companion.setEnabled(false); assert.equal(companion.getSnapshot().history.available, false);
});

test('节奏仅比较真实周期剩余比例，断线未知，周日期跨年补年份', () => {
  const source = snapshot(NOW, [quotaWindow(300, 5)]);
  source.history = { available: true, windows: [], results: [], resetHistory: [] };
  assert.equal(buildQuotaLabelModel(source, {}, NOW).items[0].pace.state, 'fast');
  source.quota.stale = true;
  assert.deepEqual(buildQuotaLabelModel(source, {}, NOW).items[0].pace,
    { state: 'unknown', remainingTimePercent: null });
  source.tasks.state = 'disconnected'; source.tasks.items = [{ id: ID, state: 'active' }];
  const model = buildCodexDetailsModel(source, {}, NOW);
  assert.equal(model.activity.runningCount, null); assert.equal(model.tasks[0].state, 'unknown');
  const time = new Date(2026, 11, 30, 12).getTime();
  assert.equal(formatQuotaDate(new Date(2026, 11, 31, 18, 5).getTime(), 10080, time), '12/31 18:05');
  assert.equal(formatQuotaDate(new Date(2027, 0, 1, 18, 5).getTime(), 10080, time), '2027/01/01 18:05');
});
