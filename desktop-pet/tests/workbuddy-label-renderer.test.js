const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture() {
  const elements = new Map(), events = {}, calls = [];
  let render, colorMode;
  const document = { addEventListener(name, handler) { events[name] = handler; }, documentElement: { dataset: {} }, body: { dataset: {} }, getElementById(id) {
    if (!elements.has(id)) elements.set(id, { textContent: '', dataset: {}, attributes: {}, events: {}, addEventListener(name, fn) { this.events[name] = fn; }, setAttribute(key, value) { this.attributes[key] = value; } });
    return elements.get(id);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../workbuddy-label-renderer.js'), 'utf8'), { document, window: { qiuqiuWorkBuddyLabel: {
    onState(cb) { render = cb; }, onColorMode(cb) { colorMode = cb; }, toggle() { calls.push('toggle'); }, refresh() { calls.push('refresh'); }, trend() { calls.push('trend'); }, tasks(kind) { calls.push(kind); }
  } } });
  return { elements, events, calls, document, render: state => render(state), colorMode: (...args) => colorMode(...args) };
}
const report = { total: 7399.91, basic: 500, reward: 6899.91, purchased: 0, plan: '体验版', nextRefreshAt: 20, updatedAt: 10,
  expires: [{ amount: 100, at: 30 }, { amount: 20, at: 30 }, { amount: 6000, at: 40 }] };
test('card preserves precise balance, zero, no connection and expired report states', () => {
  const { elements: e, render } = fixture();
  render({ report, expanded: true, appearance: 'dark' });
  assert.equal(e.get('expanded-total').textContent, '7,399.91');
  assert.equal(e.get('reward').textContent, '6,899.91');
  assert.equal(e.get('running-count').textContent, '—');
  assert.equal(e.get('unread-count').textContent, '—');
  assert.match(e.get('refresh').title, /上次成功查询/);
  assert.match(e.get('expiry').title, /120 积分/);
  assert.doesNotMatch(e.get('expiry').title, /6,120/);
  render({ report: { ...report, total: 0 }, stale: true, expanded: true });
  assert.equal(e.get('expanded-total').textContent, '0');
  assert.equal(e.get('period').textContent, '失效');
  assert.match(e.get('expanded-total').title, /旧数据已失效/);
  render({ report: null, error: '更新失败', expanded: true });
  assert.equal(e.get('period').textContent, '未连接');
  assert.equal(e.get('balance-state').textContent, '未连接');
  assert.match(e.get('balance-state').title, /WorkBuddy 未连接/);
  assert.equal(e.get('expanded-total').textContent, '—');
  render({ report: null, spaceError: true });
  assert.match(e.get('toggle').title, /空间不足/);
});
test('card delegates trend and refresh actions, keeps keyboard focus distinct and follows theme', () => {
  const { elements: e, events, calls, document, render, colorMode } = fixture();
  for (const id of ['toggle', 'expanded-header', 'refresh', 'trend', 'tasks', 'results']) e.get(id).events.click();
  assert.deepEqual(calls, ['toggle', 'toggle', 'refresh', 'trend', 'tasks', 'results']);
  events.keydown({ key: 'Tab' }); assert.equal(document.documentElement.dataset.keyboard, 'true');
  events.pointerdown(); assert.equal(document.documentElement.dataset.keyboard, 'false');
  colorMode('accessible', 'dark', 'blue');
  assert.equal(document.documentElement.dataset.colorMode, 'accessible');
  assert.equal(document.documentElement.dataset.uiTheme, 'blue');
  assert.equal(document.documentElement.dataset.accessibleAppearance, 'dark');
  render({ report, history: [{ at: 1, total: 7400 }], expanded: true });
  assert.match(e.get('trend').title, /1 次实际采样/);
  render({ report, historyError: '趋势记录暂未保存' });
  assert.equal(e.get('trend').title, '趋势记录暂未保存');
  render({report,activity:{runningCount:null,unreadCount:0}});
  assert.equal(e.get('running-count').textContent,'—');
  assert.equal(e.get('unread-count').textContent,'0');
  assert.match(e.get('tasks').title,/实时进行中数量暂未提供/);
  assert.match(e.get('results').title,/不是全局任务统计/);
  let prevented=false;
  e.get('expanded-header').events.contextmenu({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(calls.at(-1),'refresh');
});
test('card reuses Codex v20 components, with a trend entry and no inline chart or chat', () => {
  const html = fs.readFileSync(path.join(__dirname, '../workbuddy-label.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../workbuddy-label.css'), 'utf8');
  for (const sheet of ['quota-label.css', 'color-mode.css']) assert.ok(html.includes(sheet));
  for (const name of ['v20-header', 'v20-brand', 'v20-caption', 'v20-value-row', 'v20-value', 'v20-reset', 'v20-auxiliary', 'v20-shared', 'v20-links', 'v20-trend']) assert.ok(html.includes(name));
  assert.match(css, /var\(--quota-subtle\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.equal(html.includes('quota-trend-curve.js'), false);
  assert.equal(html.includes('id="trend-chart"'), false);
  assert.equal(html.includes('id="chat"'), false);
  assert.match(html, /<button id="expanded-header"[^>]*aria-label="收起 WorkBuddy 积分卡片"/);
  assert.match(html, /<span id="collapse"/);
});
