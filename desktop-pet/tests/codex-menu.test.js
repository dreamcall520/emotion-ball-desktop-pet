const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.join(__dirname, '../lib/codex-menu.js');
const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
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
  assert.match(labels, /最近提醒/);
  assert.match(labels, /刷新状态/);
  assert.equal(all.some(item => typeof item.click === 'function'), false);
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

test('多任务提醒只能打开选择菜单，不可通过气泡直达任意任务', () => {
  const { resolveCodexAction } = api();
  const value = snapshot();
  value.tasks.items.push({ ...value.tasks.items[0], id: ID2 });
  value.currentAlert.taskIds = [ID, ID2];
  assert.deepEqual(resolveCodexAction(value, alertAction('show-tasks'), TIME), { type: 'show-tasks' });
  assert.equal(resolveCodexAction(value, alertAction('open-task', { taskId: ID }), TIME), null);
});

test('当前气泡过期后仍可从近期提醒菜单进入有效任务', () => {
  const { buildCodexMenu, resolveCodexAction } = api();
  const value = snapshot(); value.currentAlert = null;
  const recent = buildCodexMenu(value, TIME + 9000).find(item => item.label === '最近提醒');
  const action = recent.submenu.find(item => item.action).action;
  assert.deepEqual(action, menuAction('open-task', { taskId: ID }));
  assert.ok(resolveCodexAction(value, action, TIME + 9000));
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
