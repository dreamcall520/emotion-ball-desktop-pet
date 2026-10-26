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
test('card preserves precise balance, zero, no connection and stale report states', () => {
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
  assert.equal(e.get('period').textContent, '待更新');
  assert.match(e.get('expanded-total').title, /上次成功查询/);
  render({ report: null, error: '更新失败', expanded: true });
  assert.equal(e.get('period').textContent, '未连接');
  assert.equal(e.get('balance-state').textContent, '未连接');
  assert.match(e.get('balance-state').title, /WorkBuddy 未连接/);
  assert.equal(e.get('expanded-total').textContent, '—');
  render({ report: null, spaceError: true });
  assert.match(e.get('toggle').title, /空间不足/);
});
test('enterprise card renders real remaining, zero and unlimited then restores personal labels', () => {
  const { elements: e, render } = fixture();
  const enterprise = { scope: 'enterprise', unlimited: false, total: 7.25, limit: 100, used: 30, plan: '企业版', basic: null, reward: null, purchased: null, nextRefreshAt: null, expires: [], updatedAt: 10 };
  render({ report: enterprise, expanded: true });
  assert.equal(e.get('expanded-total').textContent, '7.25'); assert.equal(e.get('balance-caption').textContent, '剩余额度');
  assert.equal(e.get('basic-label').textContent, '已用'); assert.equal(e.get('basic').textContent, '30');
  assert.equal(e.get('reward-label').textContent, '限额'); assert.equal(e.get('reward').textContent, '100');
  assert.equal(e.get('purchased-item').hidden, true); assert.equal(e.get('basic-item').hidden, false); assert.equal(e.get('reward-item').hidden, false); assert.match(e.get('refresh-date').title, /企业周期/);
  render({ report: { ...enterprise, total: 0 } }); assert.equal(e.get('total').textContent, '0');
  const unlimited = { ...enterprise, unlimited: true, total: null, limit: null };
  render({ report: unlimited });
  assert.equal(e.get('total').textContent, '30'); assert.equal(e.get('expanded-total').textContent, '30');
  assert.equal(e.get('period').textContent, '已用'); assert.equal(e.get('balance-state').textContent, '积分');
  assert.equal(e.get('basic-item').hidden, true); assert.equal(e.get('reward-item').hidden, false); assert.equal(e.get('reward').textContent, '未设上限');
  assert.equal(e.get('balance-caption').textContent, '本期已用');
  assert.match(e.get('expanded-total').title, /本期已用 30 积分/); assert.doesNotMatch(e.get('expanded-total').title, /余额|剩余|∞/);
  assert.match(e.get('toggle').attributes['aria-label'], /本期已用 30 积分/);
  render({ report: { ...unlimited, used: 0 } }); assert.equal(e.get('total').textContent, '0');
  render({ report: unlimited, busy: true, stale: true }); assert.equal(e.get('period').textContent, '查询中'); assert.equal(e.get('balance-state').textContent, '查询中');
  render({ report: unlimited, stale: true });
  assert.equal(e.get('period').textContent, '待更新'); assert.match(e.get('expanded-total').title, /上次成功查询/);
  assert.match(e.get('toggle').attributes['aria-label'], /企业额度未设上限/);
  render({ report });
  assert.equal(e.get('basic-label').textContent, '基础'); assert.equal(e.get('reward-label').textContent, '奖励');
  assert.equal(e.get('purchased-item').hidden, false); assert.equal(e.get('purchased').textContent, '0'); assert.equal(e.get('basic-item').hidden, false); assert.equal(e.get('reward-item').hidden, false);
  assert.equal(e.get('balance-caption').textContent, '剩余积分'); assert.match(e.get('refresh-date').title, /基础刷新/);
});
test('busy takes priority over stale data, while login errors and retry time stay explicit', () => {
  const { elements: e, document, render } = fixture();
  render({ report, stale: true, busy: true, error: '暂未更新', nextRetryAt: 20000 });
  assert.equal(e.get('period').textContent, '查询中'); assert.equal(e.get('balance-state').textContent, '查询中');
  assert.equal(document.body.dataset.invalid, 'false'); assert.equal(e.get('refresh').disabled, true);
  assert.match(e.get('toggle').title, /正在更新/);
  render({ report, stale: true, error: '连接暂未恢复', errorCode: 'TIMEOUT', nextRetryAt: 20000 });
  assert.equal(e.get('period').textContent, '待更新'); assert.match(e.get('expanded-header').title, /下次重试/);
  assert.doesNotMatch(e.get('expanded-header').title, /每5分钟/);
  render({ report: null, error: '请在 WorkBuddy 中重新登录', errorCode: 'LOGIN_REQUIRED' });
  assert.equal(e.get('period').textContent, '需登录'); assert.equal(e.get('balance-state').textContent, '需登录');
  assert.match(e.get('toggle').title, /重新登录/);
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
  assert.match(e.get('trend').title, /官方积分消耗/);
  render({ report, historyError: '趋势记录暂未保存' });
  assert.equal(e.get('trend').title, '查看官方积分消耗走势与每日消耗');
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

test('API and WorkBuddy compact cards use local source artwork with explicit accessible names', () => {
  for(const [file,source,name] of [['api-usage-label','openai','OpenAI API'],['workbuddy-label','workbuddy','WorkBuddy']]) {
    const html=fs.readFileSync(path.join(__dirname,`../${file}.html`),'utf8');
    assert.match(html,/img-src 'self'/);assert(html.includes(`src="assets/integrations/${source}.png"`));
    assert(html.includes(`role="img" aria-label="${name}" title="${name}"`));
    assert.doesNotMatch(html,/<span class="summary-badge">(?:API|WB)<\/span>/);
  }
});

test('API root button always announces the full OpenAI API source, including empty and error states', () => {
  const nodes=new Map();let receive;
  const element=()=>({dataset:{},attributes:{},textContent:'',addEventListener(){},setAttribute(key,value){this.attributes[key]=value;},replaceChildren(){},append(){}});
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../api-usage-label-renderer.js'),'utf8'),{
    document:{documentElement:{dataset:{}},getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element,createTextNode:text=>({textContent:text})},
    window:{addEventListener(){},qiuqiuApiUsageLabel:{onState(callback){receive=callback;}}}
  });
  for(const state of [{connected:false},{connected:true},{connected:true,busy:true},{connected:true,error:'offline'},{connected:true,expanded:true,report:{month:'2026-10',costs:{month:[{currency:'USD',value:91.4}]}}}]) {
    receive(state);assert.match(nodes.get('quota-label').attributes['aria-label'],/OpenAI API/);assert.match(nodes.get('quota-label').title,/OpenAI API/);
  }
  const wb=fixture();for(const state of [{},{stale:true,report},{error:'offline',report}]){wb.render(state);assert.match(wb.elements.get('toggle').attributes['aria-label'],/WorkBuddy/);assert.match(wb.elements.get('toggle').title,/WorkBuddy/);}
});
