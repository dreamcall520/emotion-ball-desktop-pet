const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ID = '019fae37-6bb8-7873-8873-14a6661bd1f1';
const SECOND = '019fae37-6bb8-7873-8873-14a6661bd1f2';
const SECRET = 'SECRET_BODY_OR_TOKEN';
function state() {
  const file = path.resolve(__dirname, '../lib/codex-state.js');
  assert.ok(fs.existsSync(file), '需要只保留允许字段的 Codex 状态模块');
  return require(file);
}
const quota = primary => ({ rateLimits: { limitId: 'codex', limitName: 'Codex', primary } });
const window = { usedPercent: 85, windowDurationMins: 300, resetsAt: 2000000000 };

test('额度按真实窗口计算剩余比例并统一为毫秒', () => {
  assert.deepEqual(state().normalizeQuota(quota(window), 100), {
    windows: [{ id: 'codex:primary', label: 'Codex', windowMinutes: 300, remaining: 15, resetsAt: 2000000000000 }],
    updatedAt: 100
  });
});

test('旧版单额度池未返回编号时明确归为通用 Codex 额度', () => {
  assert.deepEqual(state().normalizeQuota({ rateLimits: { primary: window } }, 100).windows, [{
    id: 'codex:primary', label: 'codex', windowMinutes: 300, remaining: 15,
    resetsAt: 2000000000000
  }]);
});

test('额度只保留可用重置机会数量，不保留重置凭据详情', () => {
  const result = state().normalizeQuota({
    ...quota(window),
    rateLimitResetCredits: {
      availableCount: 1,
      credits: [{ id: SECRET, title: SECRET, description: SECRET }]
    }
  }, 100);
  assert.equal(result.resetCreditsAvailable, 1);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  for (const availableCount of [-1, 1.5, '1', Number.NaN, Infinity]) {
    assert.equal('resetCreditsAvailable' in state().normalizeQuota({
      ...quota(window), rateLimitResetCredits: { availableCount }
    }, 100), false);
  }
});

test('优先多类额度，不重复旧rateLimits；同周期的主次窗口仍有独立键', () => {
  const result = state().normalizeQuota({
    rateLimits: { primary: window },
    rateLimitsByLimitId: {
      codex: { limitName: 'Codex', primary: window, secondary: { ...window, usedPercent: 100 } },
      other: { primary: { ...window, windowDurationMins: 10080 } }
    }, token: SECRET
  }, 100);
  assert.deepEqual(result.windows.map(w => w.id), ['codex:primary', 'codex:secondary', 'other:primary']);
  assert.deepEqual(result.windows.map(w => w.remaining), [15, 0, 15]);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

for (const [key, values, normalized] of [
  ['usedPercent', [-1, 101, '85', null, NaN, Infinity], 'remaining'],
  ['windowDurationMins', [-1, 0, 1.5, '300', null, Infinity], 'windowMinutes'],
  ['resetsAt', [-1, 0, '2000000000', null, NaN, Infinity], 'resetsAt']
]) {
  for (const value of values) test(`额度 ${key} 非法值 ${String(value)} 标记未知`, () => {
    assert.equal(state().normalizeQuota(quota({ ...window, [key]: value }), 100).windows[0][normalized], 'unknown');
  });
}

test('缺失额度不捏造默认五小时或每周额度', () => {
  assert.deepEqual(state().normalizeQuota({}, 100), { windows: [], updatedAt: 100 });
  assert.deepEqual(state().normalizeQuota(quota({}), 100).windows[0], {
    id: 'codex:primary', label: 'Codex', windowMinutes: 'unknown', remaining: 'unknown', resetsAt: 'unknown'
  });
});

test('规范化任务不保留正文、错误文本、目录或请求参数', () => {
  const result = state().normalizeTask({ id: ID, title: '标题', cwd: SECRET, rolloutPath: SECRET,
    turns: [{ turnId: 'one', status: 'inProgress', items: [{ text: SECRET }], error: SECRET }],
    requests: [{ method: 'item/commandExecution/requestApproval', params: { command: SECRET } }]
  }, 100);
  assert.deepEqual(result, { id: ID, title: '标题', state: 'waiting', turnId: 'one', updatedAt: 100, partial: true });
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

for (const [type, expected] of [['active', 'active'], ['idle', 'idle'], ['notLoaded', 'unknown'], ['error', 'unknown']]) {
  test(`运行标志 ${type} 正确映射，不误报结束`, () => {
    assert.equal(state().normalizeTask({ id: ID, threadRuntimeStatus: { type } }, 100).state, expected);
  });
}

for (const flag of ['waitingOnApproval', 'waitingOnUserInput']) test(`${flag} 是等待状态`, () => {
  assert.equal(state().normalizeTask({ id: ID, threadRuntimeStatus: { type: 'active', activeFlags: [flag] } }, 100).state, 'waiting');
});

for (const status of ['completed', 'failed', 'interrupted']) test(`最新轮次明确 ${status} 才报告该终态`, () => {
  const result = state().normalizeTask({ id: ID, threadRuntimeStatus: { type: 'idle' }, turns: [
    { turnId: 'first', status: 'inProgress' }, { turnId: 'last', status }
  ] }, 100);
  assert.equal(result.state, status);
  assert.equal(result.turnId, 'last');
});

test('canonical轮次按开始时间选最新，不依赖实体键顺序；不保留历史内容', () => {
  const raw = { id: ID, turns: [], turnHistory: { kind: 'canonical', history: { entitiesByKey: {
    'turn:new': { turnId: 'new', status: 'inProgress', turnStartedAtMs: 200, items: [SECRET], params: SECRET },
    'turn:old': { turnId: 'old', status: 'completed', turnStartedAtMs: 100 },
    'item:foo': { text: SECRET }
  } } } };
  const result = state().normalizeTask(raw, 300);
  assert.equal(result.state, 'active');
  assert.equal(result.turnId, 'new');
  assert.equal(JSON.stringify(state().projectTask(raw)).includes(SECRET), false);
});

for (const status of ['inProgress', 'completed', 'failed', 'interrupted']) {
  test(`canonical本地tail轮次读取真实 ${status}，键不要求等于轮次ID`, () => {
    const raw = { id: ID, threadRuntimeStatus: { type: 'idle' }, turns: [],
      turnHistory: { kind: 'canonical', history: { entitiesByKey: {
        'tail:1:local:0': { turnId: 'one', status, turnStartedAtMs: 100, items: [SECRET], params: { input: SECRET } }
      } } } };
    const result = state().normalizeTask(raw, 200);
    assert.equal(result.state, status === 'inProgress' ? 'idle' : status);
    assert.equal(result.turnId, 'one');
    assert.equal(JSON.stringify(state().projectTask(raw)).includes(SECRET), false);
  });
}

test('canonical混合持久化轮次和本地tail仍按时间排序，缺时间不猜测', () => {
  const raw = { id: ID, turnHistory: { kind: 'canonical', history: { entitiesByKey: {
    'turn:old': { turnId: 'old', status: 'failed', turnStartedAtMs: 100 },
    'tail:7:local:1': { turnId: 'new', status: 'completed', turnStartedAtMs: 200 }
  } } } };
  assert.equal(state().normalizeTask(raw, 300).state, 'completed');
  assert.equal(state().normalizeTask(raw, 300).turnId, 'new');
  delete raw.turnHistory.history.entitiesByKey['tail:7:local:1'].turnStartedAtMs;
  assert.equal(state().normalizeTask(raw, 300).state, 'unknown');
});

test('canonical本地tail整体增量及状态增量可合并，轮次身份改变要求新快照', () => {
  let current = state().projectTask({ id: ID, turns: [] });
  const path = ['turnHistory', 'history', 'entitiesByKey', 'tail:3:local:0'];
  let result = state().applyTaskPatches(current, [{ op: 'add', path,
    value: { turnId: 'one', status: 'inProgress', turnStartedAtMs: 100, items: [SECRET] } }]);
  assert.equal(result.needsSnapshot, false);
  assert.equal(state().taskFromProjection(result.task, 200).state, 'active');
  current = result.task;
  result = state().applyTaskPatches(current, [{ op: 'replace', path: [...path, 'status'], value: 'completed' }]);
  assert.equal(result.needsSnapshot, false);
  assert.equal(state().taskFromProjection(result.task, 200).state, 'completed');
  assert.equal(JSON.stringify(result.task).includes(SECRET), false);
  result = state().applyTaskPatches(current, [{ op: 'replace', path,
    value: { turnId: 'different', status: 'completed', turnStartedAtMs: 200 } }]);
  assert.equal(result.needsSnapshot, true);
});

test('未知新轮次不回退成旧轮次已完成，notLoaded压过旧终态', () => {
  assert.equal(state().normalizeTask({ id: ID, turns: [{ turnId: 'old', status: 'completed' }, { turnId: 'new', status: 'futureStatus' }] }, 100).state, 'unknown');
  assert.equal(state().normalizeTask({ id: ID, threadRuntimeStatus: { type: 'notLoaded' }, turns: [{ turnId: 'old', status: 'completed' }] }, 100).state, 'unknown');
});

test('canonical存在无法排序的轮次时不拿旧终态冒充最新任务已完成', () => {
  const known = ['turn:old', { turnId: 'old', status: 'completed', turnStartedAtMs: 100 }];
  const undated = ['turn:new', { turnId: 'new', status: 'inProgress' }];
  for (const entries of [[known, undated], [undated, known]]) {
    const result = state().normalizeTask({ id: ID, turnHistory: { kind: 'canonical', history: { entitiesByKey: Object.fromEntries(entries) } } }, 200);
    assert.equal(result.state, 'unknown');
  }
});

test('排序不确定性不能被旧轮次状态或整体增量清除，只由完整有序快照解除', () => {
  for (const startedAt of [undefined, 100]) {
    const history = { kind: 'canonical', history: { entitiesByKey: {
      'turn:old': { turnId: 'old', status: 'completed', turnStartedAtMs: 100 },
      'turn:new': { turnId: 'new', status: 'inProgress', turnStartedAtMs: startedAt }
    } } };
    let current = state().projectTask({ id: ID, turnHistory: history });
    assert.equal(state().taskFromProjection(current, 100).state, 'unknown');
    const path = ['turnHistory', 'history', 'entitiesByKey', 'turn:old'];
    for (const patch of [
      { op: 'replace', path: [...path, 'status'], value: 'completed' },
      { op: 'replace', path, value: { turnId: 'old', status: 'completed', turnStartedAtMs: 100 } },
      { op: 'add', path: ['turnHistory', 'history', 'entitiesByKey', 'turn:third'], value: { turnId: 'third', status: 'completed', turnStartedAtMs: 300 } }
    ]) {
      const result = state().applyTaskPatches(current, [patch]); current = result.task;
      assert.equal(result.needsSnapshot, false); assert.equal(state().taskFromProjection(current, 200).state, 'unknown');
    }
    history.history.entitiesByKey['turn:new'].turnStartedAtMs = 200;
    assert.equal(state().normalizeTask({ id: ID, turnHistory: history }, 300).state, 'active');
  }
});

test('归档、远端或身份变化的增量必须重验范围，不能继续复用旧状态', () => {
  const task = state().projectTask({ id: ID, turns: [{ turnId: 'one', status: 'completed' }] });
  for (const [key, value] of [['archived', true], ['ephemeral', true], ['hostId', 'remote'], ['id', SECOND], ['parent_thread_id', SECOND]]) {
    const result = state().applyTaskPatches(task, [{ op: 'replace', path: [key], value }]);
    assert.equal(result.needsSnapshot, true, key);
  }
});

test('runtime深层非状态字段丢弃，不把工具细节当成状态缺口', () => {
  const task = state().projectTask({ id: ID, threadRuntimeStatus: { type: 'active' } });
  const result = state().applyTaskPatches(task, [{ op: 'add', path: ['threadRuntimeStatus', 'futureDetails', 'nested'], value: SECRET }]);
  assert.equal(result.needsSnapshot, false); assert.deepEqual(result.task, task);
});

test('运行中不因历史已完成或未知请求而误报完成或等待', () => {
  assert.equal(state().normalizeTask({ id: ID, threadRuntimeStatus: { type: 'active' },
    turns: [{ turnId: 'old', status: 'completed' }], requests: [{ method: SECRET, params: SECRET }]
  }, 100).state, 'active');
});

test('元数据排除归档、远端、子代理、非法ID；只取20条不引用预览作标题', () => {
  const many = Array.from({ length: 22 }, (_, i) => ({ id: `019fae37-6bb8-7873-8873-${String(i).padStart(12, '0')}`, source: 'vscode', name: '任务', preview: SECRET, updatedAt: i + 1 }));
  const result = state().normalizeThreadList({ data: [
    { id: ID, archived: true }, { id: SECOND, hostId: 'remote' },
    { id: ID, source: { subAgent: { thread_spawn: {} } } },
    { id: ID, parentThreadId: SECOND }, { id: 'not-a-thread' }, ...many
  ] });
  assert.equal(result.length, 20);
  assert.equal(result[0].id, many[21].id);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.equal(state().normalizeThreadList({ data: [{ id: ID, preview: SECRET }] })[0].title, '未命名任务');
});

for (const threadSource of ['user', 'agent_created_thread', 'agent_forked_thread']) {
  test(`普通任务来源 ${threadSource} 与客户端来源分别校验，不误排为内部子代理`, () => {
    const row = { id: ID, source: 'vscode', threadSource, hostId: 'local', name: '用户任务' };
    assert.equal(state().isEligibleThread(row), true);
    assert.equal(state().normalizeThreadList({ data: [row] })[0]?.id, ID);
  });
}

test('普通任务来源不能绕过内部子代理、未知来源及原有范围限制', () => {
  const row = { id: ID, source: 'vscode', threadSource: 'agent_created_thread', hostId: 'local' };
  for (const invalid of [
    { source: { subAgent: { thread_spawn: {} } } }, { threadSource: 'subAgentThreadSpawn' },
    { source: 'agent_created_thread' }, { threadSource: 'future_unknown_source' },
    { threadSource: { subAgent: {} } }, { parentThreadId: SECOND }, { parent_thread_id: SECOND },
    { archived: true }, { ephemeral: true }, { hostId: 'remote' }, { id: 'invalid' }
  ]) assert.equal(state().isEligibleThread({ ...row, ...invalid }), false, JSON.stringify(invalid));
});

test('patch只合并当前轮次状态标量，其它正文丢弃', () => {
  const projected = state().projectTask({ id: ID, title: '标题', turns: [{ turnId: 'one', status: 'inProgress' }] });
  const result = state().applyTaskPatches(projected, [
    { op: 'replace', path: ['turns', 0, 'items'], value: [SECRET] },
    { op: 'replace', path: ['turns', 0, 'status'], value: 'completed' }
  ]);
  assert.equal(result.needsSnapshot, false);
  assert.equal(state().taskFromProjection(result.task, 100).state, 'completed');
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.equal(state().taskFromProjection(projected, 100).state, 'active');
});

test('无法安全合并的轮次变更请求新快照，不猜测终态', () => {
  const projected = state().projectTask({ id: ID, turns: [{ turnId: 'one', status: 'completed' }] });
  assert.equal(state().applyTaskPatches(projected, [{ op: 'remove', path: ['turns', 0] }]).needsSnapshot, true);
  assert.equal(state().applyTaskPatches(projected, [{ op: 'replace', path: ['__proto__', 'state'], value: 'completed' }]).needsSnapshot, false);
  assert.equal({}.state, undefined);
});

test('正常canonical整条新turn添加或替换立即投影状态，不需要重新快照', () => {
  const projected = state().projectTask({ id: ID, turnHistory: { kind: 'canonical', history: { entitiesByKey: {
    'turn:one': { turnId: 'one', status: 'completed', turnStartedAtMs: 100 }
  } } } });
  const path = ['turnHistory', 'history', 'entitiesByKey', 'turn:two'];
  const added = state().applyTaskPatches(projected, [{ op: 'add', path, value: { turnId: 'two', status: 'inProgress', turnStartedAtMs: 200, items: [SECRET], params: SECRET } }]);
  assert.equal(added.needsSnapshot, false); assert.equal(added.task.turn.turnId, 'two');
  assert.equal(state().taskFromProjection(added.task, 200).state, 'active');
  const replaced = state().applyTaskPatches(added.task, [{ op: 'replace', path, value: { turnId: 'two', status: 'completed', turnStartedAtMs: 200, items: [SECRET] } }]);
  assert.equal(replaced.needsSnapshot, false); assert.equal(state().taskFromProjection(replaced.task, 201).state, 'completed');
  assert.equal(JSON.stringify(replaced).includes(SECRET), false);
});

test('legacy追加轮次保留正常状态连续性，替换旧轮次不抢最新轮次', () => {
  const projected = state().projectTask({ id: ID, turns: [{ turnId: 'one', status: 'completed' }] });
  const added = state().applyTaskPatches(projected, [{ op: 'add', path: ['turns', 1], value: { turnId: 'two', status: 'inProgress', items: [SECRET] } }]);
  assert.equal(added.needsSnapshot, false); assert.equal(added.task.turn.turnId, 'two');
  const old = state().applyTaskPatches(added.task, [{ op: 'replace', path: ['turns', 0], value: { turnId: 'one', status: 'completed' } }]);
  assert.equal(old.needsSnapshot, false); assert.equal(old.task.turn.turnId, 'two');
});

test('canonical全对象变化开始时间不明或轮次ID不符，仍保守重取快照', () => {
  const projected = state().projectTask({ id: ID, turnHistory: { kind: 'canonical', history: { entitiesByKey: {
    'turn:one': { turnId: 'one', status: 'completed', turnStartedAtMs: 100 }
  } } } });
  for (const turn of [{ turnId: 'two', status: 'inProgress' }, { turnId: 'wrong', status: 'completed', turnStartedAtMs: 200 }]) {
    assert.equal(state().applyTaskPatches(projected, [{ op: 'add', path: ['turnHistory', 'history', 'entitiesByKey', 'turn:two'], value: turn }]).needsSnapshot, true);
  }
});

test('canonical所有非状态深层变化直接丢弃，不重设基线或重拉历史', () => {
  const projected = state().projectTask({ id: ID, turnHistory: { kind: 'canonical', history: { entitiesByKey: {
    'turn:one': { turnId: 'one', status: 'inProgress', turnStartedAtMs: 100 }
  } } } });
  const patches = ['commandExecutionStartedAtMsById', 'hookRuns', 'additionalMetadata', 'unknownFutureBody'].map(field => ({
    op: 'replace', path: ['turnHistory', 'history', 'entitiesByKey', 'turn:one', field, 'nested'], value: SECRET
  }));
  const result = state().applyTaskPatches(projected, patches);
  assert.equal(result.needsSnapshot, false);
  assert.deepEqual(result.task, projected);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test('审批请求索引增删只保留白名单method，可连续进入和解除等待', () => {
  const projected = state().projectTask({ id: ID, threadRuntimeStatus: { type: 'active' }, requests: [] });
  const added = state().applyTaskPatches(projected, [{ op: 'add', path: ['requests', 0], value: { method: 'item/permissions/requestApproval', params: { token: SECRET } } }]);
  assert.equal(added.needsSnapshot, false); assert.equal(state().taskFromProjection(added.task, 100).state, 'waiting');
  assert.equal(JSON.stringify(added).includes(SECRET), false);
  const removed = state().applyTaskPatches(added.task, [{ op: 'remove', path: ['requests', 0] }]);
  assert.equal(removed.needsSnapshot, false); assert.equal(state().taskFromProjection(removed.task, 100).state, 'active');
});

test('等待flag索引增删可连续更新，未知flag和请求方法不保留敏感值', () => {
  const projected = state().projectTask({ id: ID, threadRuntimeStatus: { type: 'active', activeFlags: [] }, requests: [{ method: SECRET, params: SECRET }] });
  const added = state().applyTaskPatches(projected, [{ op: 'add', path: ['threadRuntimeStatus', 'activeFlags', 0], value: 'waitingOnUserInput' }]);
  assert.equal(added.needsSnapshot, false); assert.equal(state().taskFromProjection(added.task, 100).state, 'waiting');
  const removed = state().applyTaskPatches(added.task, [{ op: 'remove', path: ['threadRuntimeStatus', 'activeFlags', 0] }]);
  assert.equal(removed.needsSnapshot, false); assert.equal(state().taskFromProjection(removed.task, 100).state, 'active');
  assert.equal(JSON.stringify(removed).includes(SECRET), false);
});

for (const source of ['requests', 'activeFlags']) test(`${source}超限后收到完整空列表可独立恢复，不永久unknown`, () => {
  const task = state().projectTask({ id: ID,
    requests: source === 'requests' ? Array(65).fill({ method: 'item/tool/requestUserInput' }) : [],
    threadRuntimeStatus: { type: 'active', activeFlags: source === 'activeFlags' ? Array(65).fill('waitingOnApproval') : [] }
  });
  assert.equal(state().taskFromProjection(task, 100).state, 'unknown');
  const path = source === 'requests' ? ['requests'] : ['threadRuntimeStatus', 'activeFlags'];
  const result = state().applyTaskPatches(task, [{ op: 'replace', path, value: [] }]);
  assert.equal(result.needsSnapshot, false); assert.equal(state().taskFromProjection(result.task, 101).state, 'active');
});

for (const first of ['requests', 'activeFlags']) test(`先恢复${first}不能清掉另一来源仍超限的unknown`, () => {
  const task = state().projectTask({ id: ID, requests: Array(65).fill({ method: 'item/tool/requestUserInput' }),
    threadRuntimeStatus: { type: 'active', activeFlags: Array(65).fill('waitingOnApproval') } });
  const paths = [['requests'], ['threadRuntimeStatus', 'activeFlags']];
  if (first === 'activeFlags') paths.reverse();
  const partial = state().applyTaskPatches(task, [{ op: 'replace', path: paths[0], value: [] }]);
  assert.equal(partial.needsSnapshot, false); assert.equal(state().taskFromProjection(partial.task, 100).state, 'unknown');
  const restored = state().applyTaskPatches(partial.task, [{ op: 'replace', path: paths[1], value: [] }]);
  assert.equal(restored.needsSnapshot, false); assert.equal(state().taskFromProjection(restored.task, 101).state, 'active');
});

test('完整runtime替换只重算flag超限，不清掉requests超限', () => {
  const task = state().projectTask({ id: ID, requests: Array(65).fill({ method: 'item/tool/requestUserInput' }),
    threadRuntimeStatus: { type: 'active', activeFlags: Array(65).fill('waitingOnApproval') } });
  const flagsRestored = state().applyTaskPatches(task, [{ op: 'replace', path: ['threadRuntimeStatus'], value: { type: 'active', activeFlags: [] } }]);
  assert.equal(flagsRestored.needsSnapshot, false); assert.equal(state().taskFromProjection(flagsRestored.task, 100).state, 'unknown');
  const restored = state().applyTaskPatches(flagsRestored.task, [{ op: 'replace', path: ['requests'], value: [] }]);
  assert.equal(restored.needsSnapshot, false); assert.equal(state().taskFromProjection(restored.task, 101).state, 'active');
});
