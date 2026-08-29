const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.join(__dirname, '../lib/codex-menu.js');
const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';
const CASE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CASE_ID2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TIME = 1800000000000;
function api() {
  assert.ok(fs.existsSync(modulePath), 'Codex menu model must exist');
  return require(modulePath);
}
function snapshot() {
  return {
    enabled: true, generation: 7,
    quota: { state: 'connected', code: null, updatedAt: TIME, stale: false,
      windows: [{ id: 'codex:primary', label: 'Codex', remaining: 18, windowMinutes: 300, resetsAt: TIME + 3600000 }] },
    tasks: { state: 'connected', code: null, partial: true,
      items: [{ id: ID, title: '测试任务', state: 'waiting', turnId: 'turn-one', updatedAt: TIME }] },
    recent: [{ id: 2, kind: 'waiting', text: '有一步等你确认哦', taskIds: [ID], createdAt: TIME, presentedAt: TIME }],
    currentAlert: { id: 2, generation: 7, kind: 'waiting', motion: 'peek', text: '有一步等你确认哦',
      taskIds: [ID], createdAt: TIME, expiresAt: TIME + 8000 }
  };
}
function entries(menu) { return menu.flatMap(item => [item, ...entries(item.submenu || [])]); }
const menuAction = (type, extra = {}) => ({ scope: 'menu', type, generation: 7, ...extra });
const alertAction = (type, extra = {}) => ({ scope: 'alert', type, generation: 7, alertId: 2, ...extra });

test('关闭时不生成Codex状态菜单', () => {
  const { buildCodexMenu } = api();
  assert.deepEqual(buildCodexMenu({ ...snapshot(), enabled: false }, TIME), []);
});

test('额度按真实类别周期比例和重置显示，任务明确最近最多20个', () => {
  const { buildCodexMenu } = api();
  const all = entries(buildCodexMenu(snapshot(), TIME));
  const labels = all.map(item => item.label || '').join('\n');
  assert.match(labels, /Codex/);
  assert.match(labels, /5小时/);
  assert.match(labels, /18%/);
  assert.match(labels, /重置/);
  assert.match(labels, /最近最多20个任务/);
  assert.match(labels, /等你确认/);
  assert.doesNotMatch(labels, /最近提醒/);
  assert.equal(all.some(item => item.id === 'codex-recent'), false);
  assert.match(labels, /刷新状态/);
  assert.equal(all.some(item => typeof item.click === 'function'), false);
});

test('任务列表只显示处理中和等你确认，并移除最近提醒', () => {
  const { buildCodexMenu } = api();
  const value = snapshot();
  const idAt = index => `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`;
  value.tasks.items = ['active', 'waiting', 'completed', 'failed', 'interrupted', 'idle', 'unknown']
    .map((state, index) => ({ id: idAt(index), title: state, state, turnId: `turn-${index}` }));
  value.tasks.items.push({ id: idAt(7), title: 'unavailable-active', state: 'active', unavailable: 'STATE_TOO_LARGE' });
  value.recent = [{ id: 9, kind: 'completed', text: '不应出现的最近提醒', taskIds: [idAt(2)] }];
  const menu = buildCodexMenu(value, TIME);
  const taskItems = menu.find(item => item.id === 'codex-tasks').submenu;
  const labels = taskItems.map(item => item.label).join('\n');
  assert.match(labels, /active.*处理中/);
  assert.match(labels, /waiting.*等你确认/);
  assert.doesNotMatch(labels, /completed|failed|interrupted|idle|unknown|unavailable-active/);
  assert.equal(menu.some(item => item.id === 'codex-recent'), false);
  assert.equal(JSON.stringify(menu).includes('不应出现的最近提醒'), false);
});

test('任务列表最多显示20项，其余任务只显示不可点击提示', () => {
  const { buildCodexMenu } = api();
  const value = snapshot();
  value.tasks.items = Array.from({ length: 23 }, (_, index) => ({
    id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    title: `任务${index + 1}`,
    state: index % 2 ? 'waiting' : 'active'
  }));
  const items = buildCodexMenu(value, TIME).find(item => item.id === 'codex-tasks').submenu;
  assert.equal(items.filter(item => item.action?.type === 'open-task').length, 20);
  assert.deepEqual(items.at(-1), { label: '另有 3 个，请到 Codex 查看', enabled: false });
});

test('大小写不同的同一任务只保留后到的最新行并统一小写ID', () => {
  const { buildCodexMenu } = api();
  const value = snapshot();
  value.tasks.items = [
    { id: CASE_ID, title: '旧的已完成行', state: 'completed' },
    { id: CASE_ID.toUpperCase(), title: '最新任务', state: 'active' }
  ];
  const items = buildCodexMenu(value, TIME).find(item => item.id === 'codex-tasks').submenu;
  assert.equal(items.filter(item => item.action?.taskId?.toLowerCase() === CASE_ID).length, 1);
  assert.match(items[0].label, /最新任务.*处理中/);
  assert.equal(items[0].action.taskId, CASE_ID);
});

test('已连接但筛选后为空时如实显示无进行中任务', () => {
  const { buildCodexMenu } = api();
  const value = snapshot();
  value.tasks.items = [{ id: ID, title: '已完成', state: 'completed' }];
  const items = buildCodexMenu(value, TIME).find(item => item.id === 'codex-tasks').submenu;
  assert.deepEqual(items, [{ label: '暂无进行中或待确认的任务', enabled: false }]);
});

test('已连接但只有不可用任务时不伪报为无进行中任务', () => {
  const { buildCodexMenu } = api();
  const value = snapshot();
  value.tasks.code = 'PARTIAL_STATE';
  value.tasks.items = [{ id: ID, title: '暂时不可读任务', state: 'active', unavailable: 'STATE_TOO_LARGE' }];
  const menu = buildCodexMenu(value, TIME);
  const progress = menu.find(item => item.label?.startsWith('任务进展：')).label;
  assert.match(progress, /部分任务暂不可用/);
  assert.deepEqual(menu.find(item => item.id === 'codex-tasks').submenu,
    [{ label: '部分任务暂不可用，请到 Codex 查看', enabled: false }]);
});

test('已连接且正常与不可用任务并存时保留正常项并标明部分不可用', () => {
  const { buildCodexMenu } = api();
  const value = snapshot();
  value.tasks.items = [
    { id: ID, title: '正常任务', state: 'waiting' },
    { id: ID2, title: '不可用任务', state: 'active', unavailable: 'STATE_TOO_LARGE' }
  ];
  const menu = buildCodexMenu(value, TIME);
  const progress = menu.find(item => item.label?.startsWith('任务进展：')).label;
  const taskItems = menu.find(item => item.id === 'codex-tasks').submenu;
  assert.match(progress, /部分任务暂不可用/);
  assert.equal(taskItems.length, 1);
  assert.match(taskItems[0].label, /正常任务.*等你确认/);
  assert.doesNotMatch(JSON.stringify(taskItems), /不可用任务/);
});

test('标题按纯文本截断、去控制符、转义菜单加速键，不采用接口URL', () => {
  const { buildCodexMenu } = api();
  const value = snapshot();
  value.tasks.items[0].title = `A&B\n${'长'.repeat(80)}<script>`;
  value.tasks.items[0].url = 'javascript:SECRET_BODY';
  const menu = buildCodexMenu(value, TIME);
  const entry = entries(menu).find(item => item.action?.taskId === ID);
  assert.ok(entry.label.startsWith('A&&B'));
  assert.equal(entry.label.includes('\n'), false);
  assert.match(entry.label, /…/);
  assert.ok(entry.label.length < 70);
  assert.equal(JSON.stringify(menu).includes('SECRET_BODY'), false);
  assert.deepEqual(entry.action, menuAction('open-task', { taskId: ID }));
});

test('两个通道独立标识，不支持及大状态包不伪装为已连接', () => {
  const { buildCodexMenu } = api();
  const value = snapshot();
  value.tasks.state = 'unsupported'; value.tasks.code = 'STATE_TOO_LARGE';
  value.tasks.items[0].state = 'unknown'; value.tasks.items[0].unavailable = 'STATE_TOO_LARGE';
  const labels = entries(buildCodexMenu(value, TIME)).map(item => item.label || '').join('\n');
  assert.match(labels, /额度：已连接/);
  assert.match(labels, /任务进展：暂不支持/);
  assert.match(labels, /状态包过大，暂不可用/);
  assert.doesNotMatch(labels, /任务进展：已连接/);
  assert.doesNotMatch(labels, /任务进展：暂不支持.*部分任务暂不可用/);
});

test('额度已连接但桌面状态服务缺失时，不误报Codex未安装', () => {
  const { buildCodexMenu } = api();
  const value = snapshot();
  value.tasks.state = 'missing'; value.tasks.code = 'MISSING';
  const labels = entries(buildCodexMenu(value, TIME)).map(item => item.label || '').join('\n');
  assert.match(labels, /额度：已连接/);
  assert.match(labels, /任务进展：未连接桌面任务/);
  assert.doesNotMatch(labels, /未找到 Codex/);
  value.quota.state = 'missing'; value.quota.code = 'MISSING';
  const absent = entries(buildCodexMenu(value, TIME)).map(item => item.label || '').join('\n');
  assert.match(absent, /额度：未找到 Codex/);
  assert.match(absent, /任务进展：未连接桌面任务/);
});

test('缺失额度字段显示暂不可用，不编造比例周期或Invalid Date', () => {
  const { buildCodexMenu } = api();
  const value = snapshot();
  value.quota.windows = [{ id: 'unknown', label: '', remaining: 'unknown', windowMinutes: 'unknown', resetsAt: 'unknown' }];
  value.quota.updatedAt = null;
  value.tasks.items[0].title = '';
  const labels = entries(buildCodexMenu(value, TIME)).map(item => item.label || '').join('\n');
  assert.match(labels, /暂不可用/);
  assert.match(labels, /未命名任务/);
  assert.doesNotMatch(labels, /100%|0%|5小时|Invalid Date|undefined|NaN/);
});

test('保留的旧额度明确显示过期及原更新时间', () => {
  const { buildCodexMenu } = api();
  const value = snapshot(); value.quota.stale = true; value.quota.state = 'disconnected';
  const labels = entries(buildCodexMenu(value, TIME)).map(item => item.label || '').join('\n');
  assert.match(labels, /已过期/);
  assert.match(labels, /上次更新/);
  assert.match(labels, /18%/);
});

test('任务链接仅由仍存在的可信UUID构造，拒绝旧代次及关闭', () => {
  const { resolveCodexAction } = api();
  const value = snapshot();
  assert.deepEqual(resolveCodexAction(value, menuAction('open-task', { taskId: ID, url: 'javascript:bad' }), TIME),
    { type: 'open-task', taskId: ID, url: `codex://threads/${ID}` });
  assert.equal(resolveCodexAction(value, menuAction('open-task', { taskId: ID, generation: 6 }), TIME), null);
  assert.equal(resolveCodexAction({ ...value, enabled: false }, menuAction('open-task', { taskId: ID }), TIME), null);
  assert.equal(resolveCodexAction(value, menuAction('open-task', { taskId: ID2 }), TIME), null);
  value.tasks.items = [];
  assert.equal(resolveCodexAction(value, menuAction('open-task', { taskId: ID }), TIME), null);
});

test('菜单打开任务使用完整可信任务行，但拒绝不可用行和64条之外的行', () => {
  const { buildCodexMenu, resolveCodexAction } = api();
  const value = snapshot();
  value.tasks.items = [{ id: ID, title: '已完成任务', state: 'completed' }];
  assert.equal(buildCodexMenu(value, TIME).find(item => item.id === 'codex-tasks').submenu[0].enabled, false);
  assert.equal(resolveCodexAction(value, menuAction('open-task', { taskId: ID }), TIME).taskId, ID);

  value.tasks.items = [{ id: ID, title: '不可用任务', state: 'active', unavailable: 'STATE_TOO_LARGE' }];
  assert.equal(resolveCodexAction(value, menuAction('open-task', { taskId: ID }), TIME), null);

  value.tasks.items = Array.from({ length: 65 }, (_, index) => ({
    id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    title: `任务${index + 1}`,
    state: 'completed'
  }));
  assert.equal(resolveCodexAction(value, menuAction('open-task', { taskId: value.tasks.items[63].id }), TIME).taskId,
    value.tasks.items[63].id);
  assert.equal(resolveCodexAction(value, menuAction('open-task', { taskId: value.tasks.items[64].id }), TIME), null);
});

test('恶意和非法任务标识不能成为菜单动作或打开地址', () => {
  const { buildCodexMenu, resolveCodexAction } = api();
  for (const id of ['../private', 'https://example.com', 'javascript:run()', `${ID}?command=run`, '', null, {}]) {
    const value = snapshot(); value.tasks.items[0].id = id;
    assert.equal(resolveCodexAction(value, menuAction('open-task', { taskId: id }), TIME), null);
    assert.equal(entries(buildCodexMenu(value, TIME)).some(item => item.action?.type === 'open-task'), false);
  }
});

test('气泡动作同时校验当前id、代次、有效期及任务仍存在', () => {
  const { resolveCodexAction } = api();
  const value = snapshot();
  assert.equal(resolveCodexAction(value, alertAction('open-task', { taskId: ID }), TIME).url, `codex://threads/${ID}`);
  for (const action of [alertAction('open-task', { taskId: ID, alertId: 1 }), alertAction('open-task', { taskId: ID, generation: 8 }),
    alertAction('open-task', { taskId: ID2 }), { type: 'open-task', taskId: ID, generation: 7 }]) {
    assert.equal(resolveCodexAction(value, action, TIME), null);
  }
  assert.equal(resolveCodexAction(value, alertAction('open-task', { taskId: ID }), TIME + 8000), null);
  value.tasks.items = [];
  assert.equal(resolveCodexAction(value, alertAction('open-task', { taskId: ID }), TIME), null);
});

test('多任务完成提醒只生成当前提醒的临时结果菜单', () => {
  const { buildCodexResultMenu, resolveCodexAction } = api();
  const value = snapshot();
  value.tasks.items = [
    { id: ID, title: `结果&A\n${'长'.repeat(50)}`, state: 'completed', turnId: 'turn-one' },
    { id: ID2, title: '结果二', state: 'completed', turnId: 'turn-two' }
  ];
  value.currentAlert = { ...value.currentAlert, kind: 'completed', taskIds: [ID, ID2] };
  const action = resolveCodexAction(value, alertAction('show-results'), TIME);
  assert.deepEqual(action, { type: 'show-results', alertId: 2 });
  const result = buildCodexResultMenu(value, action.alertId, TIME);
  assert.deepEqual(result.map(item => item.action.taskId), [ID, ID2]);
  assert.deepEqual(result[0].action,
    { scope: 'result', type: 'open-task', generation: 7, alertId: 2, taskId: ID });
  assert.ok(result[0].label.startsWith('结果&&A '));
  assert.match(result[0].label, /…$/);
  assert.deepEqual(resolveCodexAction(value, result[0].action, TIME),
    { type: 'open-task', taskId: ID, url: `codex://threads/${ID}` });
  assert.deepEqual(buildCodexResultMenu(value, action.alertId, TIME + 8000), []);
  assert.equal(resolveCodexAction(value, alertAction('open-task', { taskId: ID }), TIME), null);
});

test('结果提醒与任务行的UUID大小写不同时仍按小写构建并解析', () => {
  const { buildCodexResultMenu, resolveCodexAction } = api();
  const value = snapshot();
  value.tasks.items = [
    { id: CASE_ID, title: '结果A', state: 'completed' },
    { id: CASE_ID2, title: '结果B', state: 'completed' }
  ];
  value.currentAlert = {
    ...value.currentAlert,
    kind: 'completed',
    taskIds: [CASE_ID.toUpperCase(), CASE_ID2.toUpperCase()]
  };
  const result = buildCodexResultMenu(value, 2, TIME);
  assert.deepEqual(result.map(item => item.action.taskId), [CASE_ID, CASE_ID2]);
  assert.deepEqual(resolveCodexAction(value, result[0].action, TIME),
    { type: 'open-task', taskId: CASE_ID, url: `codex://threads/${CASE_ID}` });
});

test('结果提醒中同一UUID的大小写变体视为重复并拒绝', () => {
  const { buildCodexResultMenu, resolveCodexAction } = api();
  const value = snapshot();
  value.tasks.items = [
    { id: CASE_ID, title: '结果A', state: 'completed' },
    { id: CASE_ID2, title: '结果B', state: 'completed' }
  ];
  value.currentAlert = {
    ...value.currentAlert,
    kind: 'completed',
    taskIds: [CASE_ID, CASE_ID.toUpperCase()]
  };
  assert.deepEqual(buildCodexResultMenu(value, 2, TIME), []);
  assert.equal(resolveCodexAction(value, alertAction('show-results'), TIME), null);
});

test('临时结果项拒绝非成员、错误提醒、旧代次、过期和已移除任务', () => {
  const { buildCodexResultMenu, resolveCodexAction } = api();
  const value = snapshot();
  value.tasks.items = [
    { id: ID, title: '结果一', state: 'completed' },
    { id: ID2, title: '结果二', state: 'completed' },
    { id: ID3, title: '非提醒成员', state: 'completed' }
  ];
  value.currentAlert = { ...value.currentAlert, kind: 'completed', taskIds: [ID, ID2] };
  const item = buildCodexResultMenu(value, 2, TIME)[0];
  const forged = [
    { ...item.action, taskId: ID3 },
    { ...item.action, alertId: 3 },
    { ...item.action, generation: 6 }
  ];
  for (const descriptor of forged) assert.equal(resolveCodexAction(value, descriptor, TIME), null);
  assert.equal(resolveCodexAction(value, item.action, TIME + 8000), null);
  value.tasks.items = value.tasks.items.filter(task => task.id !== ID);
  assert.equal(resolveCodexAction(value, item.action, TIME), null);
});

test('临时结果菜单拒绝错误提醒、旧代次、非完成、重复或不可信任务', () => {
  const { buildCodexResultMenu, resolveCodexAction } = api();
  const value = snapshot();
  value.tasks.items = [
    { id: ID, title: '结果一', state: 'completed' },
    { id: ID2, title: '结果二', state: 'completed' }
  ];
  value.currentAlert = { ...value.currentAlert, kind: 'completed', taskIds: [ID, ID2] };
  const invalid = [
    { ...value, currentAlert: { ...value.currentAlert, id: 3 } },
    { ...value, currentAlert: { ...value.currentAlert, generation: 6 } },
    { ...value, currentAlert: { ...value.currentAlert, kind: 'waiting' } },
    { ...value, currentAlert: { ...value.currentAlert, taskIds: [ID, ID] } },
    { ...value, currentAlert: { ...value.currentAlert, taskIds: [ID, '../private'] } },
    { ...value, currentAlert: { ...value.currentAlert, taskIds: [ID] } }
  ];
  for (const candidate of invalid) {
    assert.deepEqual(buildCodexResultMenu(candidate, 2, TIME), []);
    assert.equal(resolveCodexAction(candidate, alertAction('show-results'), TIME), null);
  }
  assert.deepEqual(buildCodexResultMenu(value, 3, TIME), []);
  assert.equal(resolveCodexAction(value, alertAction('show-results', { alertId: 3 }), TIME), null);
});

test('临时结果菜单在任务移除或不可用后安全失效', () => {
  const { buildCodexResultMenu, resolveCodexAction } = api();
  const value = snapshot();
  value.tasks.items = [
    { id: ID, title: '结果一', state: 'completed' },
    { id: ID2, title: '结果二', state: 'completed' }
  ];
  value.currentAlert = { ...value.currentAlert, kind: 'completed', taskIds: [ID, ID2] };
  value.tasks.items.pop();
  assert.deepEqual(buildCodexResultMenu(value, 2, TIME), []);
  assert.equal(resolveCodexAction(value, alertAction('show-results'), TIME), null);
  value.tasks.items.push({ id: ID2, title: '结果二', state: 'completed', unavailable: 'STATE_TOO_LARGE' });
  assert.deepEqual(buildCodexResultMenu(value, 2, TIME), []);
  assert.equal(resolveCodexAction(value, alertAction('show-results'), TIME), null);
});

test('旧show-tasks结果入口已移除并始终拒绝', () => {
  const { resolveCodexAction } = api();
  const value = snapshot();
  value.tasks.items.push({ ...value.tasks.items[0], id: ID2 });
  value.currentAlert.taskIds = [ID, ID2];
  assert.equal(resolveCodexAction(value, alertAction('show-tasks'), TIME), null);
  assert.equal(resolveCodexAction(value, menuAction('show-tasks'), TIME), null);
});

test('只接受限定的刷新和关闭动作，不能扩展成任务控制', () => {
  const { resolveCodexAction } = api();
  const value = snapshot();
  assert.deepEqual(resolveCodexAction(value, menuAction('refresh'), TIME), { type: 'refresh' });
  assert.deepEqual(resolveCodexAction(value, alertAction('dismiss'), TIME), { type: 'dismiss', alertId: 2 });
  for (const type of ['run', 'approve', 'resume', 'reset-quota', 'send', 'shell']) {
    assert.equal(resolveCodexAction(value, menuAction(type), TIME), null);
  }
  assert.equal(resolveCodexAction(value, alertAction('refresh'), TIME), null);
  assert.equal(resolveCodexAction(value, menuAction('dismiss'), TIME), null);
});
