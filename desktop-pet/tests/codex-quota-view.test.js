const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PERIOD_MINUTES,
  selectQuotaWindows,
  selectPrimaryQuotaWindows,
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
  assert.equal(buildQuotaLabelModel(snapshot([
    quotaWindow('codex:daily', 1440, 60), quotaWindow('gpt-reserve:weekly', 10080, 30)
  ]), { period: 'daily' }, NOW).state, 'ready');
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
  assert.deepEqual(model.items.map(item => [item.id, item.windowMinutes]), [['b', 300], ['a', 10080]]);

  const scoped = Object.freeze([
    Object.freeze(quotaWindow('gpt-reserve:secondary', 10080, 20)),
    Object.freeze(quotaWindow('codex:secondary', 10080, 40))
  ]);
  const scopedModel = buildQuotaLabelModel(snapshot(scoped), { period: 'auto' }, NOW);
  scopedModel.items[0].label = '已更改';
  assert.equal(scoped[1].label, '额度codex:secondary');
});

test('ready 每个周期只保留一个代表值，自动模式优先 5 小时再展示周额度', () => {
  const model = buildQuotaLabelModel(snapshot([
    quotaWindow('gpt-reserve:secondary', 10080, 20),
    quotaWindow('other:secondary', 10080, 1),
    quotaWindow('codex:secondary', 10080, 45),
    quotaWindow('GPT-5.3-Codex-Spark:primary', 300, 0)
  ]), { period: 'auto' }, NOW);

  assert.equal(model.state, 'ready');
  assert.deepEqual(model.items.map(item => item.id), ['GPT-5.3-Codex-Spark:primary', 'codex:secondary']);
  assert.equal(model.overflow, 0);
});

test('真实接口同时返回 5 小时和周额度时按周期保留，自动与手动模式只改变主次顺序', () => {
  const windows = [
    quotaWindow('codex_bengalfox:primary', 300, 100, NOW + 4 * 3600000, 'GPT-5.3-Codex-Spark'),
    quotaWindow('codex_bengalfox:secondary', 10080, 100, NOW + 6 * 86400000, 'GPT-5.3-Codex-Spark'),
    quotaWindow('base_model_inference:primary', 10080, 100, NOW + 6 * 86400000, 'gpt-reserve'),
    quotaWindow('codex:primary', 10080, 94, NOW + 6 * 86400000, 'codex')
  ];

  const automatic = buildQuotaLabelModel(snapshot(windows), { period: 'auto' }, NOW);
  assert.equal(automatic.state, 'ready');
  assert.deepEqual(automatic.items.map(item => [item.windowMinutes, item.remaining, item.label]), [
    [300, 100, 'Codex'],
    [10080, 94, 'Codex']
  ]);
  assert.deepEqual(selectPrimaryQuotaWindows(windows, 'auto', NOW).map(item => item.windowMinutes), [300]);

  const weekly = buildQuotaLabelModel(snapshot(windows), { period: 'weekly' }, NOW);
  assert.deepEqual(weekly.items.map(item => item.windowMinutes), [10080, 300]);
  assert.deepEqual(selectPrimaryQuotaWindows(windows, 'weekly', NOW).map(item => item.windowMinutes), [10080, 10080, 10080]);

  const fiveHour = buildQuotaLabelModel(snapshot(windows), { period: 'fiveHour' }, NOW);
  assert.deepEqual(fiveHour.items.map(item => item.windowMinutes), [300, 10080]);
});

test('ready 模型向卡片提供可用重置机会数量，非法值不冒充为零', () => {
  const ready = buildQuotaLabelModel(snapshot([
    quotaWindow('codex:secondary', 10080, 64)
  ], { resetCreditsAvailable: 1 }), { period: 'auto' }, NOW);
  assert.equal(ready.resetCreditsAvailable, 1);
  assert.equal(ready.items[0].resetsAt, NOW + 3600000);

  for (const resetCreditsAvailable of [-1, 1.5, '1', Number.NaN]) {
    const model = buildQuotaLabelModel(snapshot([
      quotaWindow('codex:secondary', 10080, 64)
    ], { resetCreditsAvailable }), { period: 'auto' }, NOW);
    assert.equal('resetCreditsAvailable' in model, false);
  }
});

test('常驻额度按主次周期各取一个可靠代表值，不显示模型内部名称', () => {
  const model = buildQuotaLabelModel(snapshot([
    quotaWindow('GPT-5.3-Codex-Spark:primary', 300, 4, NOW + 3600000, 'GPT-5.3-Codex-Spark'),
    quotaWindow('codex:primary', 300, 12, NOW + 3600000, 'Codex Five Hour'),
    quotaWindow('gpt-reserve:primary', 300, 18, NOW + 3600000, 'Reserve Five Hour'),
    quotaWindow('gpt-reserve:secondary', 10080, 100, NOW + 3600000, 'Reserve Pool'),
    quotaWindow('codex:secondary', 10080, 65, NOW + 3600000, 'Codex Weekly'),
    quotaWindow('other:secondary', 10080, 1, NOW + 3600000, 'Other')
  ]), { period: 'auto' }, NOW);

  assert.equal(model.state, 'ready');
  assert.deepEqual(model.items.map(item => [item.id, item.label, item.remaining]), [
    ['codex:primary', 'Codex', 12],
    ['codex:secondary', 'Codex', 65],
  ]);
  assert.equal(model.overflow, 0);
});

test('只有服务端返回的周窗口时直接以周额度为主，不捏造五小时窗口', () => {
  const model = buildQuotaLabelModel(snapshot([
    quotaWindow('codex:primary', 10080, 98, NOW + 6 * 86400000, 'codex')
  ]), { period: 'auto' }, NOW);

  assert.equal(model.state, 'ready');
  assert.deepEqual(model.items, [{
    id: 'codex:primary', label: 'Codex', windowMinutes: 10080, remaining: 98,
    resetsAt: NOW + 6 * 86400000
  }]);
});

test('手动周期缺失不回退，自动无有效数据时明确为 empty', () => {
  const onlyDaily = snapshot([quotaWindow('codex:daily', 1440, 60)]);
  assert.deepEqual(buildQuotaLabelModel(onlyDaily, { period: 'weekly' }, NOW), {
    state: 'period-missing', items: [], overflow: 0
  });
  assert.equal(buildQuotaLabelModel(snapshot([]), { period: 'auto' }, NOW).state, 'empty');
});

test('所选周期的重置时间已到时等待更新，不猜测新比例', () => {
  const expiredFiveHour = quotaWindow('codex:five', 300, 0, NOW);
  const expiredDaily = quotaWindow('gpt-reserve:daily', 1440, 35, NOW - 1);

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
  const futureFromEpoch = quotaWindow('codex:future', 300, 50, 1);
  assert.deepEqual(selectQuotaWindows([futureFromEpoch], 'auto', 0), [futureFromEpoch]);
  assert.equal(buildQuotaLabelModel(snapshot([futureFromEpoch]), { period: 'auto' }, 0).state, 'ready');

  for (const resetsAt of [0, -0]) {
    const invalid = quotaWindow('codex:invalid-reset', 300, 20, resetsAt);
    assert.equal(buildQuotaLabelModel(snapshot([invalid]), { period: 'auto' }, NOW).state, 'empty');
    assert.equal(buildQuotaLabelModel(snapshot([invalid]), { period: 'fiveHour' }, NOW).state, 'period-missing');
  }
});

test('stale 明确标记旧数据，仅保留仍结构有效且未到重置时间的项', () => {
  const model = buildQuotaLabelModel(snapshot([
    quotaWindow('other', 1440, 70),
    quotaWindow('gpt-reserve:secondary', 10080, 30),
    quotaWindow('codex:primary', 300, 30),
    quotaWindow('hidden-expired', 300, 0, NOW),
    { ...quotaWindow('bad', 300, 10), label: '' }
  ], { stale: true, updatedAt: NOW - 360000 }), { period: 'auto' }, NOW);

  assert.equal(model.state, 'stale');
  assert.deepEqual(model.items.map(item => item.id), ['codex:primary', 'gpt-reserve:secondary']);
  assert.equal(model.overflow, 0);
  assert.deepEqual(buildQuotaLabelModel(snapshot([], { stale: true }), { period: 'auto' }, NOW), {
    state: 'stale', items: [], overflow: 0
  });
});

test('stale 也尊重手动周期，不把其他周期旧数据当成所选周期', () => {
  const model = buildQuotaLabelModel(snapshot([
    quotaWindow('codex:daily', 1440, 10),
    quotaWindow('gpt-reserve:weekly', 10080, 80)
  ], { stale: true }), { period: 'weekly' }, NOW);
  assert.equal(model.state, 'stale');
  assert.deepEqual(model.items.map(item => item.id), ['gpt-reserve:weekly']);
  assert.equal(model.overflow, 0);
});

test('stale 有未重置旧值时保留，所选周期全部已重置时优先等待更新', () => {
  const validWeekly = quotaWindow('gpt-reserve:week-valid', 10080, 35);
  const expiredWeekly = quotaWindow('codex:week-expired', 10080, 10, NOW);
  const expiredFiveHour = quotaWindow('codex:five-expired', 300, 0, NOW - 1);

  assert.deepEqual(buildQuotaLabelModel(snapshot([expiredWeekly, validWeekly], { stale: true }),
    { period: 'weekly' }, NOW), {
    state: 'stale', items: [{ ...validWeekly, label: 'gpt-reserve' }], overflow: 0
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

test('只有 enabled 明确为 true 才允许解释已连接额度', () => {
  const visible = quotaWindow('must-stay-hidden', 300, 25);
  for (const enabled of [undefined, null, false, 0, '', 'false', [], {}]) {
    assert.deepEqual(buildQuotaLabelModel({ ...snapshot([visible]), enabled }, { period: 'auto' }, NOW), {
      state: 'disabled', items: [], overflow: 0
    });
  }
});

test('enabled false 优先于所有已知 quota 状态，统一返回 disabled', () => {
  const hidden = quotaWindow('must-stay-hidden', 300, 25);
  for (const state of ['disabled', 'connecting', 'connected', 'missing', 'unauthenticated', 'unsupported', 'disconnected']) {
    assert.deepEqual(buildQuotaLabelModel({
      enabled: false,
      quota: { state, stale: false, windows: [hidden] }
    }, { period: 'auto' }, NOW), { state: 'disabled', items: [], overflow: 0 });
  }
});

test('已连接额度的 windows、stale 和 now 必须结构完整', () => {
  const visible = quotaWindow('must-stay-hidden', 300, 25);
  const cases = [];
  for (const windows of [undefined, null, {}, 'windows', 42]) {
    cases.push({ value: { enabled: true, quota: { state: 'connected', stale: false, windows } }, now: NOW });
  }
  for (const stale of [undefined, null, 0, 1, 'false', [], {}]) {
    cases.push({ value: { enabled: true, quota: { state: 'connected', stale, windows: [visible] } }, now: NOW });
  }
  for (const now of [Number.NaN, Infinity, -1, 1.5, MAX_TIME + 1, '1800000000000']) {
    cases.push({ value: snapshot([visible]), now });
  }

  for (const entry of cases) {
    assert.deepEqual(buildQuotaLabelModel(entry.value, { period: 'auto' }, entry.now), {
      state: 'disconnected', items: [], overflow: 0
    });
  }
});

test('已知非连接状态原样返回，不要求 windows、stale 或有效 now', () => {
  for (const state of ['disabled', 'connecting', 'missing', 'unauthenticated', 'unsupported', 'disconnected']) {
    assert.deepEqual(buildQuotaLabelModel({ enabled: true, quota: { state } }, { period: 'auto' }, Number.NaN), {
      state, items: [], overflow: 0
    });
  }
});
