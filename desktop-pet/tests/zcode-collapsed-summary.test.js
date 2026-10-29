const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createZcodeCompanion } = require('../lib/zcode-companion');
const { buildZcodeQuotaLabelModel } = require('../lib/zcode-quota-view');
class Element {
  constructor() { this.dataset = {}; this.children = []; this.attributes = {}; this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  appendChild(child) { this.children.push(child); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener() {}
}
function renderFixture() {
  const nodes = Object.fromEntries(['quota-label', 'status', 'summary', 'items', 'overflow', 'codex-expanded'].map(id => [id, new Element()]));
  let receive;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../quota-label-renderer.js'), 'utf8'), {
    document: { documentElement: new Element(), getElementById: id => nodes[id], createElement: () => new Element() },
    window: { addEventListener() {}, petQuotaLabel: { onModel(callback) { receive = callback; } } }
  });
  return { nodes, receive };
}
test('ZCode collapsed summary uses a short fixed caption and preserves every bucket in its accessible title', () => {
  const { nodes, receive } = renderFixture();
  for (const count of [1, 2, 4]) for (const size of ['compact', 'standard']) for (const appearance of ['light', 'dark']) {
    const items = Array.from({ length: count }, (_, index) => ({ label: `GLM-5.3${index % 2 ? '-Flash' : ''}`,
      planName: index > 1 ? 'Start Plan 体验' : 'ZCode 1024 活动', bucketId: `zcode:bucket-${index}`, windowMinutes: 1440,
      remaining: 100, resetsAt: Date.now() + 86400000, periodKind: index > 1 ? 'daily' : 'one_time' }));
    receive({ sourceId: 'zcode', state: 'ready', size, appearance, expanded: false, items });
    assert.equal(nodes.summary.textContent, '额度100%');
    assert.equal(nodes.summary.children[0].children[0].attributes['aria-label'], 'ZCode');
    assert.equal(nodes.summary.children[0].children[1].textContent, '额度');
    assert.match(nodes['quota-label'].title, /^ZCode 剩余额度/);
    for (const item of items) {
      assert.ok(nodes['quota-label'].title.includes(item.planName));
      assert.ok(nodes['quota-label'].title.includes(item.label));
    }
    assert.equal(nodes['quota-label'].attributes['aria-label'], nodes['quota-label'].title);
  }
});
test('Codex collapsed caption identifies its source and period', () => {
  const { nodes, receive } = renderFixture();
  receive({ sourceId: 'codex', state: 'ready', size: 'compact', items: [{ label: 'Codex', windowMinutes: 300, remaining: 15 }] });
  assert.equal(nodes.summary.textContent, '5小时额度15%');
  assert.equal(nodes['quota-label'].attributes['aria-label'], 'Codex 剩余额度');
});

test('ZCode team errors use compact text and complete hover guidance, then clear on recovery', () => {
  const { nodes, receive } = renderFixture();
  for (const [code, short, reason] of [
    ['ZCODE_TEAM_SELECTION_REQUIRED', '请选择团队', /选择完整的团队、项目和套餐/],
    ['ZCODE_TEAM_KEY_MISSING', '团队待配置', /尚未配置可用 API Key/],
    ['ZCODE_TEAM_ACCESS_DENIED', '团队权限不足', /检查成员和席位权限/]
  ]) {
    receive({ sourceId: 'zcode', state: 'disconnected', statusCode: code, items: [] });
    assert.equal(nodes.status.textContent, short); assert.match(nodes.status.title, reason);
    assert.match(nodes['quota-label'].title, reason);
    assert.equal(nodes['quota-label'].attributes['aria-label'], nodes['quota-label'].title);
    assert.doesNotMatch(nodes.summary.textContent + nodes.items.textContent, /0%/);
  }
  receive({ sourceId: 'zcode', state: 'ready', items: [{ label: 'Coding Plan', bucketId: 'zcode:paid:1', windowMinutes: 300, remaining: 75 }] });
  assert.equal(nodes.status.textContent, 'ZCode 剩余额度'); assert.equal(nodes.status.title, '');
  assert.doesNotMatch(nodes['quota-label'].title, /权限|配置|选择完整/);
  receive({ sourceId: 'codex', state: 'disconnected', statusCode: 'ZCODE_TEAM_KEY_MISSING', items: [] });
  assert.equal(nodes.status.textContent, 'Codex 未连接'); assert.equal(nodes.status.title, '');
  receive({ sourceId: 'zcode', state: 'disconnected', statusCode: 'PRIVATE_RESPONSE', items: [] });
  assert.equal(nodes.status.textContent, 'ZCode 未连接'); assert.equal(nodes.status.title, '');
});

test('quota request failures render as query status while recovery, login loss and account switches remain distinct', async t => {
  const { nodes, receive } = renderFixture();
  const now = 1800000000000;
  let accountKey = 'fixture-team-a', failure = 'ZCODE_NETWORK_ERROR', accountFailure = null;
  const buckets = [{ id: 'zcode:paid:fixture', label: 'Coding Plan', planName: '团队套餐', remaining: 75,
    periodKind: 'rolling', windowMinutes: 300, periodStart: now - 60000, resetsAt: now + 299 * 60000 }];
  const service = createZcodeCompanion({ now: () => now,
    readAccount: () => { if (accountFailure) throw Object.assign(new Error('private-account-error'), { code: accountFailure });
      return { accountKey, family: 'bigmodel' }; },
    fetchUsage: async () => { if (failure) throw Object.assign(new Error('private-response'), { code: failure }); return { buckets }; },
    readTasks: async () => ({ state: 'unknown', items: [], results: [] }) });
  t.after(() => service.close());
  const render = () => { const model = buildZcodeQuotaLabelModel(service.getSnapshot(), {}, now); receive(model); return model; };
  await service.setEnabled(true);
  for (const code of ['ZCODE_NETWORK_ERROR', 'ZCODE_HTTP_ERROR', 'ZCODE_BILLING_ERROR', 'ZCODE_USAGE_UNAVAILABLE', 'ZCODE_INVALID_RESPONSE', 'PRIVATE_CODE']) {
    failure = code; await service.refresh(); const model = render();
    assert.equal(nodes.status.textContent, '额度查询失败'); assert.match(nodes.status.title, /稍后刷新/);
    assert.equal(model.statusCode, 'ZCODE_QUOTA_QUERY_FAILED'); assert.deepEqual(model.items, []);
    assert.doesNotMatch(nodes.status.textContent + nodes['quota-label'].title, /未连接|private|PRIVATE|0%/);
  }
  failure = null; await service.refresh(); const ready = render();
  assert.equal(ready.state, 'ready'); assert.equal(ready.statusCode, undefined);
  assert.equal(nodes.status.textContent, 'ZCode 剩余额度'); assert.equal(nodes.status.title, '');
  const history = service.getSnapshot().history.windows;
  failure = 'ZCODE_HTTP_ERROR'; await service.refresh(); const stale = render();
  assert.equal(stale.state, 'stale'); assert.equal(stale.statusCode, 'ZCODE_QUOTA_UPDATE_FAILED');
  assert.equal(nodes.status.textContent, '额度待更新'); assert.match(nodes.status.title, /保留上次成功结果/);
  assert.deepEqual(stale.items.map(row => row.remaining), [75]); assert.deepEqual(service.getSnapshot().history.windows, history);
  failure = 'ZCODE_LOGIN_REQUIRED'; await service.refresh(); const unauthenticated = render();
  assert.equal(unauthenticated.state, 'unauthenticated'); assert.equal(unauthenticated.statusCode, undefined);
  assert.equal(nodes.status.textContent, 'ZCode 尚未登录'); assert.equal(nodes.status.title, '');
  accountKey = 'fixture-team-b'; failure = 'ZCODE_NETWORK_ERROR'; await service.refresh(); const switched = render();
  assert.equal(switched.statusCode, 'ZCODE_QUOTA_QUERY_FAILED'); assert.deepEqual(switched.items, []);
  assert.equal(service.getSnapshot().quota.updatedAt, null); assert.doesNotMatch(nodes.status.title, /保留上次/);
  accountFailure = 'ZCODE_ACCOUNT_MISSING'; await service.refresh(); const missing = render();
  assert.equal(missing.state, 'missing'); assert.equal(missing.statusCode, undefined);
  assert.equal(nodes.status.textContent, '未找到 ZCode'); assert.equal(nodes.status.title, '');
  await service.setEnabled(false); const disabled = render();
  assert.equal(disabled.state, 'disabled'); assert.equal(disabled.statusCode, undefined);
});

test('custom-only models show unavailable quota without official quota or task requests and clear on removal', async t => {
  const { nodes, receive } = renderFixture();
  let removed = false, quotaCalls = 0, taskCalls = 0;
  const service = createZcodeCompanion({
    readAccount: () => {
      if (removed) throw Object.assign(new Error('private-file'), { code: 'ZCODE_ACCOUNT_MISSING' });
      return { family: 'custom', accountKey: 'custom-scope', personal: { hasConfigured: true,
        scope: 'private-scope', providers: [{ apiKey: 'secret-key', baseURL: 'https://private.invalid' }] } };
    },
    fetchUsage: async () => { quotaCalls++; throw new Error('must not request official quota'); },
    readTasks: async () => { taskCalls++; throw new Error('must not request official tasks'); }
  });
  t.after(() => service.close());
  const render = () => { const model = buildZcodeQuotaLabelModel(service.getSnapshot()); receive(model); return model; };
  await service.setEnabled(true); await service.refresh();
  const custom = render(), snapshot = service.getSnapshot();
  assert.equal(custom.statusCode, 'ZCODE_CUSTOM_QUOTA_UNAVAILABLE');
  assert.equal(nodes.status.textContent, '暂无额度数据'); assert.match(nodes.status.title, /已识别自定义供应商，可在聊天中查看模型/);
  assert.deepEqual(custom.items, []); assert.deepEqual(snapshot.history.windows, []);
  assert.equal(snapshot.activity.runningCount, null); assert.equal(snapshot.hasCustomProviders, true);
  assert.equal(quotaCalls, 0); assert.equal(taskCalls, 0);
  assert.doesNotMatch(JSON.stringify(snapshot) + JSON.stringify(custom) + nodes['quota-label'].title, /secret|private|未连接|0%/);
  removed = true; await service.refresh();
  assert.equal(render().statusCode, undefined); assert.equal(service.getSnapshot().hasCustomProviders, false);
  assert.equal(nodes.status.textContent, '未找到 ZCode');
  removed = false; await service.refresh(); assert.equal(render().statusCode, 'ZCODE_CUSTOM_QUOTA_UNAVAILABLE');
  await service.setEnabled(false); assert.equal(render().statusCode, undefined); assert.equal(service.getSnapshot().hasCustomProviders, false);
  await service.setEnabled(true); service.close(); assert.equal(service.getSnapshot().hasCustomProviders, false);
});

test('custom models remain identified when official quota fails, without replacing successful official balances', async t => {
  const { nodes, receive } = renderFixture(), now = 1800000000000;
  let configured = true, accountKey = 'official-a', failure = 'ZCODE_HTTP_ERROR';
  const buckets = [{ id: 'zcode:paid:fixture', label: 'Coding Plan', planName: '团队套餐', remaining: 75,
    periodKind: 'rolling', windowMinutes: 300, periodStart: now - 60000, resetsAt: now + 299 * 60000 }];
  const service = createZcodeCompanion({ now: () => now,
    readAccount: () => ({ family: 'bigmodel', accountKey, personal: { hasConfigured: configured } }),
    fetchUsage: async () => { if (failure) throw Object.assign(new Error('private-response'), { code: failure }); return { buckets }; },
    readTasks: async () => ({ state: 'unknown', items: [], results: [] }) });
  t.after(() => service.close());
  const render = () => { const model = buildZcodeQuotaLabelModel(service.getSnapshot(), {}, now); receive(model); return model; };
  await service.setEnabled(true);
  for (const code of ['ZCODE_HTTP_ERROR', 'ZCODE_TEAM_ACCESS_DENIED', 'ZCODE_LOGIN_REQUIRED']) {
    failure = code; await service.refresh();
    assert.equal(render().statusCode, 'ZCODE_CUSTOM_QUOTA_UNAVAILABLE'); assert.equal(nodes.status.textContent, '暂无额度数据');
  }
  configured = false; failure = 'ZCODE_HTTP_ERROR'; await service.refresh();
  assert.equal(render().statusCode, 'ZCODE_QUOTA_QUERY_FAILED'); assert.equal(service.getSnapshot().hasCustomProviders, false);
  configured = true; failure = null; await service.refresh();
  const ready = render(); assert.equal(ready.state, 'ready'); assert.equal(ready.statusCode, undefined); assert.equal(ready.items[0].remaining, 75);
  const history = service.getSnapshot().history.windows;
  failure = 'ZCODE_HTTP_ERROR'; await service.refresh();
  const stale = render(); assert.equal(stale.statusCode, 'ZCODE_QUOTA_UPDATE_FAILED'); assert.equal(stale.items[0].remaining, 75);
  assert.deepEqual(service.getSnapshot().history.windows, history);
  accountKey = 'official-b'; configured = false; await service.refresh();
  assert.equal(render().statusCode, 'ZCODE_QUOTA_QUERY_FAILED'); assert.equal(service.getSnapshot().hasCustomProviders, false);
  assert.deepEqual(render().items, []);
});
