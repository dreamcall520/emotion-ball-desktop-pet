const test = require('node:test');
const assert = require('node:assert/strict');
const { createMasCodexConnection } = require('../lib/mas-codex-connection');
const NOW = 1793390400000;
const ACCOUNT_A = 'a'.repeat(64), ACCOUNT_B = 'b'.repeat(64);
const usage = (extra = {}) => ({ accountKey: ACCOUNT_A, windows: [
  { id: 'codex:primary', usedPercent: 30, windowMinutes: 300, resetsAt: NOW + 3600000 }
], updatedAt: NOW, source: 'web-account-quota', ...extra });
const task = (id = 'task-a', extra = {}) => ({ id, title: '合成任务', state: 'active', turnId: 'turn-a',
  updatedAt: NOW - 100, partial: true, source: 'codex-session-log', ...extra });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(overrides = {}) {
  const events = [], usageCalls = [], taskCalls = []; let taskFactoryOptions;
  const directoryAccess = { withAccess: async () => { throw new Error('No live directory access is allowed in this fixture'); } };
  const transport = () => { throw new Error('No live network request is allowed in this fixture'); };
  const connection = createMasCodexConnection({ directoryAccess, fetch: transport, now: () => NOW,
    readUsage: async options => { usageCalls.push(options); return usage(); },
    createTasks: options => { taskFactoryOptions = options; return { read: async options => { taskCalls.push(options); return []; } }; },
    onAccount: value => events.push(['account', value]), onQuota: value => events.push(['quota', value]),
    onTask: value => events.push(['task', value]), onStatus: value => events.push(['status', value]),
    ...overrides });
  return { connection, events, usageCalls, taskCalls, directoryAccess, transport, taskFactoryOptions: () => taskFactoryOptions };
}
const values = (events, channel) => events.filter(row => row[0] === channel).map(row => row[1]);

test('quota成功先报告账户再报告剩余额度，保留窗口跨度/重置时间和来源', async () => {
  const f = harness();
  await f.connection.start();
  const projections = f.events.filter(([type]) => ['account', 'quota'].includes(type));
  assert.deepEqual(projections.map(row => row[0]), ['account', 'quota']);
  assert.deepEqual(projections[0][1], { accountKey: ACCOUNT_A });
  assert.deepEqual(projections[1][1], { windows: [{ id: 'codex:primary', label: 'Codex', windowMinutes: 300,
    remaining: 70, resetsAt: NOW + 3600000 }], updatedAt: NOW, source: 'web-account-quota' });
  assert.equal(f.usageCalls[0].includeAccountKey, true);
  assert.equal(f.usageCalls[0].directoryAccess, f.directoryAccess);
  assert.equal(f.usageCalls[0].fetch, f.transport);
  assert.ok(f.usageCalls[0].signal instanceof AbortSignal);
  assert.equal(f.taskFactoryOptions().directoryAccess, f.directoryAccess);
  await f.connection.refresh({ tasks: false });
  assert.equal(values(f.events, 'account').length, 1);
  assert.equal(values(f.events, 'quota').length, 2);
  f.connection.close();
});
test('同源余额与重置机会从托管reader完整传入companion，不泄漏原响应字段',async t=>{
 const {projectManagedCodexQuota}=require('../lib/managed-codex-quota-reader');
 const snapshot={...projectManagedCodexQuota({rateLimits:{primary:{usedPercent:100,windowDurationMins:10080,resetsAt:2000000000},credits:{hasCredits:true,unlimited:false,balance:'53489.1547310000',token:'SECRET'},spendControlReached:true},rateLimitResetCredits:{availableCount:1,credits:[{id:'reset-a',status:'available',resetType:'codexRateLimits',grantedAt:1800000000,expiresAt:1801000000}]}},NOW),accountKey:ACCOUNT_A};
 const f=harness({readUsage:async()=>snapshot});t.after(()=>f.connection.close());await f.connection.start();const q=values(f.events,'quota')[0];assert.deepEqual(q.credits,{hasCredits:true,unlimited:false,balance:'53489.1547310000'});assert.equal(q.spendControlReached,true);assert.equal(q.resetCreditsAvailable,1);assert.equal(q.resetOpportunities[0].expiresAt,1801000000000);assert.equal(q.resetDetailsPartial,false);assert.equal(q.scopes,undefined);assert.equal(q.accountKey,undefined);assert.equal(JSON.stringify(q).includes('SECRET'),false);
 const {createCodexCompanion}=require('../lib/codex-companion');const companion=createCodexCompanion({now:()=>NOW,createConnection:callbacks=>createMasCodexConnection({...callbacks,readUsage:async()=>snapshot,createTasks:()=>({read:async()=>[]})})});t.after(()=>companion.close());await companion.setEnabled(true);const copied=companion.getSnapshot().quota;assert.equal(copied.credits.balance,'53489.1547310000');assert.equal(copied.resetCreditsAvailable,1);assert.equal(copied.resetOpportunities.length,1);
});

test('缺失窗口不生成默认0，缺百分比保持null，空窗口报告unsupported', async () => {
  let current = usage({ windows: [{ id: 'codex:primary', usedPercent: null, windowMinutes: null, resetsAt: null }] });
  const f = harness({ readUsage: async () => current });
  await f.connection.start();
  assert.deepEqual(values(f.events, 'quota')[0].windows, [{ id: 'codex:primary', label: 'Codex',
    remaining: null, windowMinutes: null, resetsAt: null }]);
  assert.equal(values(f.events, 'quota')[0].windows.some(row => row.id === 'codex:secondary'), false);
  current = usage({ windows: [] });
  await f.connection.refresh({ tasks: false });
  assert.deepEqual(values(f.events, 'quota').at(-1).windows, []);
  assert.deepEqual(values(f.events, 'status').filter(row => row.channel === 'quota').at(-1),
    { channel: 'quota', state: 'unsupported', code: 'UNSUPPORTED' });
  f.connection.close();
});

test('任务日志独立失败不破坏quota，也不会发出伪造任务', async () => {
  const f = harness({ createTasks: () => ({ read: async () => { throw Object.assign(new Error('synthetic log read failure'), { code: 'EACCES' }); } }) });
  await f.connection.start();
  assert.equal(values(f.events, 'quota')[0].windows[0].remaining, 70);
  assert.deepEqual(values(f.events, 'task'), []);
  assert.deepEqual(values(f.events, 'status').filter(row => row.channel === 'tasks').at(-1),
    { channel: 'tasks', state: 'disconnected', code: 'DISCONNECTED', partial: true });
  assert.equal(values(f.events, 'status').filter(row => row.channel === 'quota').at(-1).state, 'connected');
  f.connection.close();
});

test('忽略任务不进入callback，消失任务仅降unknown一次而不是completed/idle', async () => {
  let rows = [task('visible'), task('ignored')], forwarded;
  const ignoreTask = id => id === 'ignored';
  const ignoreThread = thread => thread.cwd === '/synthetic/chat';
  const f = harness({ ignoreTask, ignoreThread, createTasks: options => {
    forwarded = options; return { read: async () => rows };
  } });
  await f.connection.start();
  assert.equal(forwarded.ignoreTask, ignoreTask); assert.equal(forwarded.ignoreThread, ignoreThread);
  assert.deepEqual(values(f.events, 'task').map(row => row.id), ['visible']);
  rows = [];
  await f.connection.refresh({ quota: false });
  const missing = values(f.events, 'task').at(-1);
  assert.equal(missing.id, 'visible'); assert.equal(missing.state, 'unknown');
  assert.equal(missing.partial, true); assert.equal(missing.updatedAt, NOW);
  await f.connection.refresh({ quota: false });
  assert.equal(values(f.events, 'task').length, 2);
  f.connection.close();
});

test('并发refresh按频道复用未完成请求，结束后才允许下一轮', async () => {
  const quotaGate = deferred(), tasksGate = deferred(); let quotaCalls = 0, tasksCalls = 0;
  const f = harness({ readUsage: async () => { quotaCalls++; return quotaGate.promise; },
    createTasks: () => ({ read: async () => { tasksCalls++; return tasksGate.promise; } }) });
  const started = f.connection.start();
  const refresh1 = f.connection.refresh(), refresh2 = f.connection.retry({ quota: true, tasks: false });
  await Promise.resolve();
  assert.equal(quotaCalls, 1); assert.equal(tasksCalls, 1);
  quotaGate.resolve(usage()); tasksGate.resolve([]);
  await Promise.all([started, refresh1, refresh2]);
  await f.connection.refresh();
  assert.equal(quotaCalls, 2); assert.equal(tasksCalls, 2);
  f.connection.close();
});

test('close中止两频道signal并丢弃迟到的quota/task结果和状态，关闭后不再发请求', async () => {
  const quotaGate = deferred(), tasksGate = deferred(); let quotaSignal, taskSignal, count = 0;
  const f = harness({ readUsage: async ({ signal }) => { quotaSignal = signal; count++; return quotaGate.promise; },
    createTasks: () => ({ read: async ({ signal }) => { taskSignal = signal; count++; return tasksGate.promise; } }) });
  const started = f.connection.start(); await Promise.resolve();
  f.connection.close(); f.connection.close();
  assert.equal(quotaSignal.aborted, true); assert.equal(taskSignal.aborted, true);
  const before = f.events.length;
  quotaGate.resolve(usage()); tasksGate.resolve([task()]);
  await started; await f.connection.refresh(); await f.connection.start();
  assert.equal(f.events.length, before); assert.equal(count, 2);
  assert.deepEqual(values(f.events, 'account'), []);
  assert.deepEqual(values(f.events, 'quota'), []); assert.deepEqual(values(f.events, 'task'), []);
});

test('close后的迟到拒绝被吸收，不报告错误状态或产生未处理拒绝', async () => {
  const gate = deferred();
  const f = harness({ readUsage: async () => gate.promise });
  const started = f.connection.start(); await Promise.resolve();
  f.connection.close(); const count = f.events.length;
  gate.reject(Object.assign(new Error('late permission loss'), { code: 'DIRECTORY_ACCESS_REQUIRED' }));
  await started; assert.equal(f.events.length, count);
});

test('目录权限失效映射missing，重新授权后retry恢复；登录失效区分unauthenticated', async () => {
  let errorCode = 'DIRECTORY_ACCESS_REQUIRED';
  const getUsage = async () => { if (errorCode) throw Object.assign(new Error('synthetic'), { code: errorCode }); return usage(); };
  const f = harness({ readUsage: getUsage, createTasks: () => ({ read: async () => {
    if (errorCode) throw Object.assign(new Error('synthetic'), { code: errorCode }); return [];
  } }) });
  await f.connection.start();
  for (const channel of ['quota', 'tasks']) {
    assert.equal(values(f.events, 'status').filter(row => row.channel === channel).at(-1).state, 'missing');
    assert.equal(values(f.events, 'status').filter(row => row.channel === channel).at(-1).code, 'MISSING');
  }
  assert.deepEqual(values(f.events, 'quota'), []);
  errorCode = null; await f.connection.retry();
  assert.equal(values(f.events, 'quota').at(-1).windows[0].remaining, 70);
  errorCode = 'LOGIN_REQUIRED'; await f.connection.refresh({ tasks: false });
  assert.deepEqual(values(f.events, 'status').filter(row => row.channel === 'quota').at(-1),
    { channel: 'quota', state: 'unauthenticated', code: 'UNAUTHENTICATED' });
  f.connection.close();
});

test('账户key变化在新quota前报告，安全key传递不暴露账号/凭据', async () => {
  let key = ACCOUNT_A;
  const f = harness({ readUsage: async () => usage({ accountKey: key }) });
  await f.connection.start();
  key = ACCOUNT_B; await f.connection.refresh({ tasks: false });
  assert.deepEqual(f.events.filter(([type]) => ['account', 'quota'].includes(type)).map(([type, value]) =>
    type === 'account' ? [type, value.accountKey] : [type]), [['account', ACCOUNT_A], ['quota'], ['account', ACCOUNT_B], ['quota']]);
  assert.ok(values(f.events, 'account').every(value => Object.keys(value).join() === 'accountKey' && /^[a-f0-9]{64}$/.test(value.accountKey)));
  f.connection.close();
});

test('quota慢于本机任务日志时，首次账户回调不能清掉已读取任务', async t => {
  const { createCodexCompanion } = require('../lib/codex-companion');
  const gate = deferred();
  const visible = task('11111111-1111-4111-8111-000000000001');
  const companion = createCodexCompanion({ now: () => NOW,
    createConnection: callbacks => createMasCodexConnection({ ...callbacks, now: () => NOW,
      readUsage: async () => gate.promise, createTasks: () => ({ read: async () => [visible] }) }) });
  t.after(() => companion.close());
  const starting = companion.setEnabled(true);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(companion.getSnapshot().tasks.items.length, 1);
  gate.resolve(usage()); await starting;
  assert.equal(companion.getSnapshot().tasks.items.length, 1);
});
