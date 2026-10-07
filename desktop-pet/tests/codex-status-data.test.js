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

test('账号与真实周期隔离，余额回升/大跳变和长断档保留旧采样', () => {
  let time = NOW; const store = createQuotaHistory({ now: () => time }); store.setAccount('a');
  store.record(snapshot(time, [quotaWindow(300, 80)]));
  time += 120000; store.record(snapshot(time, [quotaWindow(300, 78)]));
  assert.equal(store.getState().windows[0].samples.length, 2);
  time += 120000; store.record(snapshot(time, [quotaWindow(300, 90)]));
  assert.equal(store.getState().windows[0].samples.length, 3);
  assert.deepEqual(store.getState().windows[0].samples.at(-1), { at: time, remaining: 90 });
  time += 120000; store.record(snapshot(time, [quotaWindow(300, 40)]));
  assert.equal(store.getState().windows[0].samples.length, 4);
  time += 600000; store.record(snapshot(time, [quotaWindow(300, 39)]));
  assert.equal(store.getState().windows[0].samples.length, 5);
  time += 120000; store.record(snapshot(time, [quotaWindow(300, 80, time + 5 * 3600000)]));
  assert.equal(store.getState().windows.length, 2);
  store.setAccount('b'); assert.deepEqual(store.getState().windows, []);
  store.setAccount('a'); assert.equal(store.getState().windows.length, 2);
  store.setAccount(null); assert.equal(store.getState().available, false);
});

test('关闭更新后重开仍保留同周历史，秒级重置波动不产生新周期', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-history-upgrade-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'history.json'); let time = NOW;
  const reset = NOW + 7 * 86400000;
  const original = createQuotaHistory({ filePath, now: () => time }); original.setAccount('a');
  original.record(snapshot(time, [quotaWindow(10080, 90, reset)]));
  time += 120000; original.record(snapshot(time, [quotaWindow(10080, 89, reset + 1000)]));
  original.close(); time += 6 * 3600000;
  const reopened = createQuotaHistory({ filePath, now: () => time }); reopened.setAccount('a');
  reopened.record(snapshot(time, [quotaWindow(10080, 70, reset)]));
  const windows = reopened.getState().windows;
  assert.equal(windows.length, 1); assert.equal(windows[0].samples.length, 3);
  assert.equal(windows[0].samples[0].at, NOW);
  assert.equal(windows[0].samples.at(-1).at, time);
  const source = snapshot(time, [quotaWindow(10080, 70, reset + 1000)]);
  source.history = reopened.getState();
  assert.equal(buildCodexDetailsModel(source, {}, time).trend.samples.length, 3);
  reopened.record(snapshot(time, [quotaWindow(10080, 70, reset + 60000)]));
  assert.equal(reopened.getState().windows.length, 2);
});

test('已有秒级重复周期加载时合并、排序并去重合法样本', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-history-merge-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'history.json'); let time = NOW;
  const original = createQuotaHistory({ filePath, now: () => time }); original.setAccount('a');
  original.record(snapshot(time, [quotaWindow(300, 80)]));
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const account = Object.values(data.accounts)[0]; const row = account.windows[0];
  account.windows.push({ ...row, resetsAt: row.resetsAt + 1000, samples: [
    {at:NOW+240000,remaining:74}, {at:NOW+120000,remaining:78},
    {at:NOW+240000,remaining:75}, {at:NOW-4*3600000,remaining:100}, {at:NOW+360000,remaining:101}
  ] });
  fs.writeFileSync(filePath, JSON.stringify(data)); time += 240000;
  const loaded = createQuotaHistory({ filePath, now: () => time }); loaded.setAccount('a');
  const windows = loaded.getState().windows;
  assert.equal(windows.length, 1);
  assert.deepEqual(windows[0].samples, [
    {at:NOW,remaining:80}, {at:NOW+120000,remaining:78}, {at:NOW+240000,remaining:75}
  ]);
});

test('日志采样仅导入确认账户的可信当前周期，同时间本地优先、重复导入不写盘', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-history-import-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'history.json'); const store = createQuotaHistory({filePath,now:()=>NOW});
  const window = quotaWindow(); const sample = (at,remaining,extra={}) => ({at,remaining,
    id:window.id,windowMinutes:window.windowMinutes,resetsAt:window.resetsAt,...extra});
  const entries = [sample(NOW-60000,62),sample(NOW-120000,63,{resetsAt:window.resetsAt+1000}),
    sample(NOW-120000,64),sample(NOW,99),sample(NOW+1,50),
    sample(window.resetsAt-window.windowMinutes*60000-1,90),sample(NOW-180000,-1),
    sample(NOW-180000,101),sample(NOW-180000,65,{resetsAt:window.resetsAt+2000}),
    sample(NOW-180000,65,{id:'codex:secondary'}),sample(NOW-180000,65,{windowMinutes:10080})];
  assert.equal(store.importSamples([window],entries),false);
  store.setAccount('a'); store.record(snapshot(NOW,[window]));
  const rename = fs.renameSync; let writes = 0;
  fs.renameSync = (from,to) => { if (to===filePath) writes++; return rename(from,to); };
  try { assert.equal(store.importSamples([window],entries),true); } finally { fs.renameSync=rename; }
  assert.equal(writes,1);
  assert.deepEqual(store.getState().windows[0].samples,[
    {at:NOW-120000,remaining:64},{at:NOW-60000,remaining:62},{at:NOW,remaining:60}]);
  const saved = fs.readFileSync(filePath,'utf8');
  assert.equal(store.importSamples([window],entries),false);
  assert.equal(fs.readFileSync(filePath,'utf8'),saved);
  assert.equal(store.importSamples([window],Array(12001).fill(sample(NOW,50))),false);
  store.setAccount('b');
  assert.equal(store.importSamples([window],[sample(NOW-60000,65,{resetsAt:window.resetsAt+60000})]),false);
  assert.deepEqual(store.getState().windows,[]);
  store.close(); assert.equal(store.importSamples([window],entries),false);
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

test('旧断档/余额回升/骤降不会阻止恢复后的连续预测，也不会跨边界外推', () => {
  for (const boundary of ['gap','increase','drop']) {
    let time = NOW; const store = createQuotaHistory({now:()=>time}); store.setAccount('a');
    store.record(snapshot(time,[quotaWindow(300,80)]));
    time += 120000; store.record(snapshot(time,[quotaWindow(300,78)]));
    const resumed = time + (boundary==='gap' ? 600000 : 120000);
    const startRemaining = boundary==='increase' ? 90 : boundary==='drop' ? 40 : 76;
    for (let index=0;index<=5;index++) {
      time=resumed+index*120000;
      const source=snapshot(time,[quotaWindow(300,startRemaining-index)]);
      store.record(source); source.history=store.getState();
      const trend=buildCodexDetailsModel(source,{},time).trend;
      assert.equal(trend.samples.length,index+3);
      assert.equal(trend.forecast.state,index<5?'unknown':'estimate',`${boundary}, ${index}`);
    }
  }
});

test('可作虚线端点的稀疏5h和周记录保留展示，但不能累计成连续预测', () => {
  for (const [period, offsets] of [[300,[1200000,600000,0]],[10080,[90000000,43200000,0]]]) {
    const window=quotaWindow(period,88,NOW+3600000);
    const samples=offsets.map((offset,index)=>({at:NOW-offset,remaining:90-index}));
    const source=snapshot(NOW,[window]);
    source.history={available:true,windows:[{...window,samples}]};
    const before=JSON.stringify(source);
    const trend=buildCodexDetailsModel(source,{period},NOW).trend;
    assert.deepEqual(trend.samples,samples);
    assert.equal(trend.forecast.state,'unknown');
    assert.equal(JSON.stringify(source),before);
  }
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


test('全部已读一次持久化，保留任务及结果记录，账号隔离且后续新轮次仍待查看', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'qiuqiu-all-read-'));
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
  const filePath = path.join(directory,'history.json'); let time = NOW, callbacks;
  const history = createQuotaHistory({filePath,now:() => time});
  const companion = createCodexCompanion({history,now:() => time,createConnection(value) {
    callbacks = value; return {start() { value.onAccount({accountKey:'a'}); value.onStatus({channel:'tasks',state:'connected'}); },close() {}};
  }});
  t.after(() => companion.close());
  assert.equal(companion.markAllRead(),false); await companion.setEnabled(true);
  const send = (id,state,turnId) => callbacks.onTask({id,state,turnId,title:'测试任务',updatedAt:time});
  send(ID,'active','first'); send(ID2,'active','first'); time++;
  send(ID,'completed','first'); send(ID2,'failed','first');
  assert.equal(buildQuotaLabelModel(companion.getSnapshot(),{},time).activity.unreadCount,2);
  const before = companion.getSnapshot().tasks.items, rename = fs.renameSync; let writes = 0;
  fs.renameSync = (from,to) => { if (to === filePath) writes++; return rename(from,to); };
  try { assert.equal(companion.markAllRead(),true); assert.equal(companion.markAllRead(),false); } finally { fs.renameSync = rename; }
  assert.equal(writes,1); assert.deepEqual(companion.getSnapshot().tasks.items,before);
  assert.equal(companion.getSnapshot().history.results.length,2);
  assert.equal(buildQuotaLabelModel(companion.getSnapshot(),{},time).activity.unreadCount,0);
  const loaded = createQuotaHistory({filePath,now:() => time}); loaded.setAccount('a');
  assert.ok(loaded.getState().results.every(row => row.readAt === time));
  send(ID,'active','second'); time++; send(ID,'completed','second');
  assert.equal(buildQuotaLabelModel(companion.getSnapshot(),{},time).activity.unreadCount,1);
  callbacks.onAccount({accountKey:'b'}); assert.equal(companion.markAllRead(),false);
  callbacks.onAccount({accountKey:'a'});
  assert.equal(buildQuotaLabelModel(companion.getSnapshot(),{},time).activity.unreadCount,1);
  await companion.setEnabled(false); assert.equal(companion.markAllRead(),false);
});

test('标读写盘失败回滚本机标记，不伪装清空，重试后读态可恢复', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'qiuqiu-read-failed-'));
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
  const filePath = path.join(directory,'history.json'), errors = [];
  const store = createQuotaHistory({filePath,now:() => NOW,onError:code => errors.push(code)});
  store.setAccount('a'); store.record({...snapshot(NOW),tasks:{results:[ID,ID2].map(id => ({id,turnId:'one',title:'结果',state:'completed',updatedAt:NOW}))}});
  const original = fs.readFileSync(filePath,'utf8'), rename = fs.renameSync;
  fs.renameSync = (from,to) => { if (to === filePath) throw new Error('write failed'); return rename(from,to); };
  try { assert.equal(store.markAllRead(),false); assert.equal(store.markRead(ID,'one'),false); } finally { fs.renameSync = rename; }
  assert.deepEqual(errors,['HISTORY_WRITE_FAILED','HISTORY_WRITE_FAILED']);
  assert.ok(store.getState().results.every(row => row.readAt === null));
  assert.equal(fs.readFileSync(filePath,'utf8'),original);
  assert.equal(store.markAllRead(),true);
  const loaded = createQuotaHistory({filePath,now:() => NOW}); loaded.setAccount('a');
  assert.ok(loaded.getState().results.every(row => row.readAt === NOW));
});
