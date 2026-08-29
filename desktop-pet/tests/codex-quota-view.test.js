const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PERIOD_MINUTES,
  selectQuotaWindows,
  buildQuotaLabelModel
} = require('../lib/codex-quota-view');

const NOW = 1800000000000;
const MAX_TIME = 8640000000000000;
const quotaWindow = (id, windowMinutes, remaining, resetsAt = NOW + 3600000, label = `额度${id}`) => ({
  id: String(id), label, windowMinutes, remaining, resetsAt
});
const snapshot = (windows, overrides = {}) => ({
  enabled: true,
  quota: { state: 'connected', stale: false, updatedAt: NOW, windows, ...overrides }
});

test('导出固定的 5 小时和周期常量', () => {
  assert.deepEqual(PERIOD_MINUTES, { fiveHour: 300, weekly: 10080 });
  assert.equal(Object.isFrozen(PERIOD_MINUTES), true);
});

test('手动周期严格筛选，自动模式保留所有有效周期', () => {
  const windows = [
    quotaWindow(1, 300, 45),
    quotaWindow(2, 10080, 20),
    quotaWindow(3, 1440, 60)
  ];

  assert.deepEqual(selectQuotaWindows(windows, 'fiveHour', NOW).map(item => item.id), ['1']);
  assert.deepEqual(selectQuotaWindows(windows, 'weekly', NOW).map(item => item.id), ['2']);
  assert.deepEqual(selectQuotaWindows(windows, 'auto', NOW).map(item => item.id), ['1', '2', '3']);
});

test('只接受结构完整、比例合法且重置时间有效的窗口', () => {
  const validZero = quotaWindow('zero', 300, 0);
  const validHundred = quotaWindow('hundred', 10080, 100);
  const invalid = [
    null,
    [],
    { ...quotaWindow('blank-id', 300, 50), id: '   ' },
    { ...quotaWindow('blank-label', 300, 50), label: '\n\t' },
    { ...quotaWindow('control', 300, 50), label: 'Codex\u0000' },
    { ...quotaWindow('long', 300, 50), id: 'x'.repeat(257) },
    { ...quotaWindow('minutes-zero', 0, 50) },
    { ...quotaWindow('minutes-fraction', 1.5, 50) },
    { ...quotaWindow('minutes-string', '300', 50) },
    { ...quotaWindow('negative', 300, -0.01) },
    { ...quotaWindow('over', 300, 100.01) },
    { ...quotaWindow('nan', 300, Number.NaN) },
    { ...quotaWindow('expired', 300, 50), resetsAt: NOW },
    { ...quotaWindow('infinite', 300, 50), resetsAt: Infinity },
    { ...quotaWindow('fractional-time', 300, 50), resetsAt: NOW + 3600000.5 },
    { ...quotaWindow('invalid-date', 300, 50), resetsAt: MAX_TIME + 1 }
  ];

  assert.deepEqual(
    selectQuotaWindows([validZero, validHundred, ...invalid], 'auto', NOW).map(item => item.id),
    ['zero', 'hundred']
  );
});

test('非法输入与周期安全降级为无数据或自动模式', () => {
  const windows = [quotaWindow('daily', 1440, 60), quotaWindow('week', 10080, 30)];
  for (const period of [undefined, null, '', 'daily', 300, {}]) {
    assert.deepEqual(selectQuotaWindows(windows, period, NOW).map(item => item.id), ['daily', 'week']);
  }
  for (const value of [undefined, null, {}, 'windows', 42]) {
    assert.deepEqual(selectQuotaWindows(value, 'auto', NOW), []);
  }
  assert.deepEqual(selectQuotaWindows(windows, 'auto', Number.NaN), []);
  assert.equal(buildQuotaLabelModel(null, null, NOW).state, 'disconnected');
  assert.equal(buildQuotaLabelModel(snapshot(windows), { period: 'daily' }, NOW).state, 'ready');
});

test('筛选最多检查前 64 项，防止无界输入', () => {
  const invalid = Array.from({ length: 64 }, (_, index) => ({ ...quotaWindow(index, 300, 50), remaining: -1 }));
  const sixtyFifth = quotaWindow('65', 300, 50);
  assert.deepEqual(selectQuotaWindows([...invalid, sixtyFifth], 'auto', NOW), []);
});

test('输出项是独立标量副本，筛选和排序均不变异输入', () => {
  const nested = { source: 'private' };
  const first = Object.freeze({ ...quotaWindow('b', 300, 40), nested });
  const second = Object.freeze({ ...quotaWindow('a', 10080, 20), nested });
  const windows = Object.freeze([first, second]);

  const selected = selectQuotaWindows(windows, 'auto', NOW);
  assert.notEqual(selected[0], first);
  assert.deepEqual(selected[0], quotaWindow('b', 300, 40));
  assert.equal('nested' in selected[0], false);

  const model = buildQuotaLabelModel(snapshot(windows), { period: 'auto' }, NOW);
  assert.deepEqual(windows.map(item => item.id), ['b', 'a']);
  model.items[0].label = '已更改';
  assert.equal(second.label, '额度a');
});

test('ready 按剩余升序和 id 稳定排序，最多显示两项并返回真实溢出数', () => {
  const model = buildQuotaLabelModel(snapshot([
    quotaWindow('z', 300, 45),
    quotaWindow('b', 10080, 20),
    quotaWindow('a', 1440, 20),
    quotaWindow('c', 60, 60)
  ]), { period: 'auto' }, NOW);

  assert.equal(model.state, 'ready');
  assert.deepEqual(model.items.map(item => item.id), ['a', 'b']);
  assert.equal(model.overflow, 2);
});

test('手动周期缺失不回退，自动无有效数据时明确为 empty', () => {
  const onlyDaily = snapshot([quotaWindow('daily', 1440, 60)]);
  assert.deepEqual(buildQuotaLabelModel(onlyDaily, { period: 'weekly' }, NOW), {
    state: 'period-missing', items: [], overflow: 0
  });
  assert.equal(buildQuotaLabelModel(snapshot([]), { period: 'auto' }, NOW).state, 'empty');
});

test('所选周期的重置时间已到时等待更新，不猜测新比例', () => {
  const expiredFiveHour = quotaWindow('five', 300, 0, NOW);
  const expiredDaily = quotaWindow('daily', 1440, 35, NOW - 1);

  assert.deepEqual(buildQuotaLabelModel(snapshot([expiredFiveHour]), { period: 'auto' }, NOW), {
    state: 'reset-wait', items: [], overflow: 0
  });
  assert.equal(buildQuotaLabelModel(snapshot([expiredFiveHour]), { period: 'fiveHour' }, NOW).state, 'reset-wait');
  assert.equal(buildQuotaLabelModel(snapshot([expiredFiveHour]), { period: 'weekly' }, NOW).state, 'period-missing');
  assert.equal(buildQuotaLabelModel(snapshot([expiredDaily]), { period: 'auto' }, NOW).state, 'reset-wait');
  assert.equal(buildQuotaLabelModel(snapshot([
    { ...expiredFiveHour, remaining: Number.NaN }
  ]), { period: 'auto' }, NOW).state, 'empty');
});

test('now 允许为 0，但 resetsAt 0 和负零必须丢弃且不触发等待更新', () => {
  const futureFromEpoch = quotaWindow('future', 300, 50, 1);
  assert.deepEqual(selectQuotaWindows([futureFromEpoch], 'auto', 0), [futureFromEpoch]);
  assert.equal(buildQuotaLabelModel(snapshot([futureFromEpoch]), { period: 'auto' }, 0).state, 'ready');

  for (const resetsAt of [0, -0]) {
    const invalid = quotaWindow('invalid-reset', 300, 20, resetsAt);
    assert.equal(buildQuotaLabelModel(snapshot([invalid]), { period: 'auto' }, NOW).state, 'empty');
    assert.equal(buildQuotaLabelModel(snapshot([invalid]), { period: 'fiveHour' }, NOW).state, 'period-missing');
  }
});

test('stale 明确标记旧数据，仅保留仍结构有效且未到重置时间的项', () => {
  const model = buildQuotaLabelModel(snapshot([
    quotaWindow('c', 1440, 70),
    quotaWindow('b', 10080, 30),
    quotaWindow('a', 300, 30),
    quotaWindow('expired', 300, 0, NOW),
    { ...quotaWindow('bad', 300, 10), label: '' }
  ], { stale: true, updatedAt: NOW - 360000 }), { period: 'auto' }, NOW);

  assert.equal(model.state, 'stale');
  assert.deepEqual(model.items.map(item => item.id), ['a', 'b']);
  assert.equal(model.overflow, 1);
  assert.deepEqual(buildQuotaLabelModel(snapshot([], { stale: true }), { period: 'auto' }, NOW), {
    state: 'stale', items: [], overflow: 0
  });
});

test('stale 也尊重手动周期，不把其他周期旧数据当成所选周期', () => {
  const model = buildQuotaLabelModel(snapshot([
    quotaWindow('daily', 1440, 10),
    quotaWindow('week', 10080, 80)
  ], { stale: true }), { period: 'weekly' }, NOW);
  assert.equal(model.state, 'stale');
  assert.deepEqual(model.items.map(item => item.id), ['week']);
  assert.equal(model.overflow, 0);
});

test('stale 有未重置旧值时保留，所选周期全部已重置时优先等待更新', () => {
  const validWeekly = quotaWindow('week-valid', 10080, 35);
  const expiredWeekly = quotaWindow('week-expired', 10080, 10, NOW);
  const expiredFiveHour = quotaWindow('five-expired', 300, 0, NOW - 1);

  assert.deepEqual(buildQuotaLabelModel(snapshot([expiredWeekly, validWeekly], { stale: true }),
    { period: 'weekly' }, NOW), {
    state: 'stale', items: [validWeekly], overflow: 0
  });
  assert.deepEqual(buildQuotaLabelModel(snapshot([expiredFiveHour], { stale: true }),
    { period: 'auto' }, NOW), { state: 'reset-wait', items: [], overflow: 0 });
  assert.deepEqual(buildQuotaLabelModel(snapshot([expiredFiveHour], { stale: true }),
    { period: 'fiveHour' }, NOW), { state: 'reset-wait', items: [], overflow: 0 });
  assert.deepEqual(buildQuotaLabelModel(snapshot([expiredFiveHour], { stale: true }),
    { period: 'weekly' }, NOW), { state: 'stale', items: [], overflow: 0 });
});

test('非连接状态原样传递且绝不携带额度项', () => {
  for (const state of ['disabled', 'connecting', 'missing', 'unauthenticated', 'unsupported', 'disconnected']) {
    const model = buildQuotaLabelModel(snapshot([quotaWindow('hidden', 300, 0)], { state, stale: true }),
      { period: 'auto' }, NOW);
    assert.deepEqual(model, { state, items: [], overflow: 0 });
  }
  assert.deepEqual(buildQuotaLabelModel({ enabled: false, quota: { windows: [] } }, {}, NOW), {
    state: 'disabled', items: [], overflow: 0
  });
});

test('未知、HTML 或非字符串连接状态统一安全降级为 disconnected', () => {
  for (const state of ['ready', '<b>connected</b>', ' connected ', '', 42, {}, null]) {
    assert.deepEqual(buildQuotaLabelModel(snapshot([quotaWindow('hidden', 300, 10)], { state }),
      { period: 'auto' }, NOW), { state: 'disconnected', items: [], overflow: 0 });
  }
});
