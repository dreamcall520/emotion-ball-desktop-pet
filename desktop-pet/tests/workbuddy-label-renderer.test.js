const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture({ measure = false } = {}) {
  const elements = new Map(), events = {}, windowEvents = {}, calls = [], widths = { left: 84, right: 77 };
  let render, colorMode;
  const document = { addEventListener(name, handler) { events[name] = handler; }, documentElement: { dataset: {} }, body: { dataset: {} }, getElementById(id) {
    if (!elements.has(id)) {
      const element = { textContent: '', style: {}, dataset: {}, attributes: {}, events: {}, addEventListener(name, fn) { this.events[name] = fn; }, setAttribute(key, value) { this.attributes[key] = value; } };
      if (measure) {
        element.measuredTextWidth = function () {
          const font = parseFloat(this.style.fontSize) || (id === 'limit-value' && this.dataset.unlimited === 'true' ? 14 : 22);
          const glyphs = [...this.textContent].reduce((sum, character) => sum + (/\d/.test(character) ? .56 : .28), 0);
          // System optical sizing makes small numerals proportionally wider.
          return font * (glyphs - .055 * this.textContent.length) + (/\d/.test(this.textContent) ? (22 - font) * .4 : 0);
        };
        element.getBoundingClientRect = function () {
          if (this.hidden) return { width: 0 };
          if (id === 'value-row') return { width: widths.left };
          if (id === 'limit-row') return { width: widths.right };
          if (id === 'balance-state') return { width: this.textContent.length * 8 };
          // The layout box can be narrower than its text; the Range below must still expose the full width.
          return { width: Math.min(this.measuredTextWidth(), id === 'expanded-total' ? widths.left : widths.right) };
        };
      }
      elements.set(id, element);
    }
    return elements.get(id);
  } };
  if (measure) document.createRange = () => {
    let selected;
    return { selectNodeContents(element) { selected = element; }, getBoundingClientRect() { return { width: selected.measuredTextWidth() }; } };
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../workbuddy-label-renderer.js'), 'utf8'), { document, window: {
    addEventListener(name, handler) { windowEvents[name] = handler; }, ...(measure ? { getComputedStyle: () => ({ columnGap: '3px' }) } : {}), qiuqiuWorkBuddyLabel: {
    onState(cb) { render = cb; }, onColorMode(cb) { colorMode = cb; }, toggle() { calls.push('toggle'); }, refresh() { calls.push('refresh'); }, trend() { calls.push('trend'); }, tasks(kind) { calls.push(kind); }
  } } });
  return { elements, events, calls, document, widths, resize: () => windowEvents.resize(), render: state => render(state), colorMode: (...args) => colorMode(...args) };
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
  const { elements: e, calls, render } = fixture();
  const enterprise = { scope: 'enterprise', unlimited: false, total: 7.25, limit: 100, used: 30, plan: '企业版', basic: null, reward: null, purchased: null, nextRefreshAt: null, expires: [], updatedAt: 10 };
  render({ report: enterprise, expanded: true });
  assert.equal(e.get('quota-label').dataset.scope, 'enterprise'); assert.equal(e.get('metrics').className, 'v20-periods dual');
  assert.equal(e.get('expanded-total').textContent, '7.25'); assert.equal(e.get('balance-caption').textContent, '积分');
  assert.equal(e.get('metric-label').textContent, '剩余额度'); assert.equal(e.get('metric-label').hidden, false);
  assert.equal(e.get('limit-cell').hidden, false); assert.equal(e.get('limit-value').textContent, '100'); assert.equal(e.get('limit-value').dataset.unlimited, 'false');
  assert.equal(e.get('balances').hidden, true); assert.equal(e.get('expiry').textContent, '已用 30 积分'); assert.equal(e.get('expiry').hidden, false);
  assert.equal(e.get('period').textContent, '剩余'); assert.equal(e.get('balance-state').textContent, '积分');
  assert.match(e.get('refresh-date').title, /企业周期/); assert.equal(e.get('refresh-date').textContent, '刷新时间未知');
  render({ report: { ...enterprise, total: 0 } }); assert.equal(e.get('total').textContent, '0');
  const unlimited = { ...enterprise, unlimited: true, total: null, limit: null };
  render({ report: unlimited });
  assert.equal(e.get('total').textContent, '30'); assert.equal(e.get('expanded-total').textContent, '30');
  assert.equal(e.get('period').textContent, '已用'); assert.equal(e.get('balance-state').textContent, '积分');
  assert.equal(e.get('limit-value').textContent, '不限额'); assert.equal(e.get('limit-value').dataset.unlimited, 'true');
  assert.equal(e.get('metric-label').textContent, '本期已用'); assert.equal(e.get('balance-caption').textContent, '积分');
  assert.equal(e.get('expiry').hidden, true); assert.equal(e.get('expiry').textContent, '');
  assert.match(e.get('expanded-total').title, /本期已用 30 积分/); assert.doesNotMatch(e.get('expanded-total').title, /余额|剩余|∞/);
  assert.match(e.get('toggle').attributes['aria-label'], /本期已用 30 积分/);
  assert.equal(e.get('expanded-total').attributes['aria-label'], e.get('expanded-total').title);
  assert.equal(e.get('limit-value').attributes['aria-label'], '企业额度未设上限');
  let prevented = false;
  e.get('expanded-header').events.contextmenu({ preventDefault() { prevented = true; } });
  for (const id of ['expanded-header', 'tasks', 'results', 'trend']) e.get(id).events.click();
  assert.equal(prevented, true); assert.deepEqual(calls, ['refresh', 'toggle', 'tasks', 'results', 'trend']);
  render({ report: { ...unlimited, used: 0 } }); assert.equal(e.get('total').textContent, '0');
  render({ report: unlimited, busy: true, stale: true }); assert.equal(e.get('period').textContent, '查询中'); assert.equal(e.get('balance-state').textContent, '查询中');
  render({ report: unlimited, stale: true });
  assert.equal(e.get('period').textContent, '待更新'); assert.match(e.get('expanded-total').title, /上次成功查询/);
  assert.match(e.get('toggle').attributes['aria-label'], /企业额度未设上限/);
  render({ report });
  assert.equal(e.get('quota-label').dataset.scope, 'personal'); assert.equal(e.get('metrics').className, '');
  assert.equal(e.get('metric-label').hidden, true); assert.equal(e.get('limit-cell').hidden, true); assert.equal(e.get('limit-value').textContent, '—');
  assert.equal(e.get('balances').hidden, false); assert.equal(e.get('expiry').hidden, false); assert.match(e.get('expiry').title, /120 积分/);
  assert.equal(e.get('basic-label').textContent, '基础'); assert.equal(e.get('reward-label').textContent, '奖励');
  assert.equal(e.get('purchased-item').hidden, false); assert.equal(e.get('purchased').textContent, '0'); assert.equal(e.get('basic-item').hidden, false); assert.equal(e.get('reward-item').hidden, false);
  assert.equal(e.get('balance-caption').textContent, '剩余积分'); assert.match(e.get('refresh-date').title, /基础刷新/);
});

test('enterprise columns keep exact amounts, readable timestamps and full long-value descriptions', () => {
  const { elements: e, render } = fixture();
  const nextRefreshAt = new Date(2026, 9, 27, 0, 5).getTime();
  const enterprise = { scope: 'enterprise', unlimited: false, total: 1234567890.12, used: 9876543210.25, limit: 11111111100.37, plan: '企业版', nextRefreshAt, expires: [], updatedAt: 10 };
  render({ report: enterprise, expanded: true });
  assert.equal(e.get('expanded-total').textContent, '1,234,567,890.12');
  assert.equal(e.get('limit-value').textContent, '11,111,111,100.37');
  assert.equal(e.get('limit-value').title, '额度上限 11,111,111,100.37 积分');
  assert.equal(e.get('expiry').textContent, '已用 9,876,543,210.25 积分'); assert.equal(e.get('expiry').title, '本期已用 9,876,543,210.25 积分');
  assert.equal(e.get('refresh-date').textContent, '10/27 00:05 刷新'); assert.match(e.get('refresh-date').title, /2026/);
  assert.match(e.get('expanded-total').title, /剩余额度 1,234,567,890.12 积分/);
  render({ report: { ...enterprise, unlimited: true, total: null, limit: null }, busy: true, stale: true });
  assert.equal(e.get('expanded-total').textContent, '9,876,543,210.25');
  assert.equal(e.get('limit-value').textContent, '不限额');
  assert.equal(e.get('balance-state').textContent, '查询中'); assert.equal(e.get('refresh').disabled, true);
  render({ report: { ...enterprise, total: 0, used: 0, limit: 0, nextRefreshAt: null } });
  assert.equal(e.get('expanded-total').textContent, '0'); assert.equal(e.get('limit-value').textContent, '0');
  assert.equal(e.get('expanded-total').dataset.long, 'false'); assert.equal(e.get('limit-value').dataset.unlimited, 'false');
  assert.equal(e.get('refresh-date').textContent, '刷新时间未知'); assert.equal(e.get('expiry').hidden, false);
  render({ report: null, error: '请在 WorkBuddy 中重新登录', errorCode: 'LOGIN_REQUIRED' });
  assert.equal(e.get('quota-label').dataset.scope, 'personal'); assert.equal(e.get('limit-cell').hidden, true);
  assert.equal(e.get('balance-state').textContent, '需登录'); assert.equal(e.get('expanded-total').textContent, '—');
});

test('enterprise amounts fit measured column widths together and restore normal sizes after updates', () => {
  const { elements: e, widths, resize, render } = fixture({ measure: true });
  const enterprise = { scope: 'enterprise', unlimited: false, total: 1232222.22, used: 2345.67, limit: 1234567.89, plan: '企业版', nextRefreshAt: null, expires: [], updatedAt: 10 };
  const fits = () => {
    assert(e.get('expanded-total').measuredTextWidth() <= widths.left);
    assert(e.get('limit-value').measuredTextWidth() <= widths.right);
  };
  render({ report: enterprise, expanded: true });
  assert.equal(e.get('expanded-total').textContent, '1,232,222.22'); assert.equal(e.get('limit-value').textContent, '1,234,567.89');
  assert.equal(e.get('expanded-total').style.fontSize, e.get('limit-value').style.fontSize);
  const initialSize = parseFloat(e.get('expanded-total').style.fontSize);
  assert(initialSize >= 10 && initialSize < 22); fits();
  assert.equal(e.get('balance-state').hidden, true); assert.equal(e.get('balance-caption').textContent, '积分');
  widths.left = 70; widths.right = 63; resize();
  assert(parseFloat(e.get('expanded-total').style.fontSize) < initialSize); fits();
  widths.left = 84; widths.right = 77;
  render({ report: enterprise, expanded: true, busy: true, stale: true });
  assert.equal(e.get('balance-caption').textContent, '查询中'); assert.match(e.get('balance-caption').attributes['aria-label'], /正在更新/); fits();
  render({ report: enterprise, expanded: true, stale: true });
  assert.equal(e.get('balance-caption').textContent, '待更新'); assert.equal(e.get('balance-state').hidden, true); fits();
  render({ report, expanded: true });
  assert.equal(e.get('balance-caption').textContent, '剩余积分'); assert.equal(e.get('balance-caption').title, '');
  assert.equal(e.get('balance-caption').attributes['aria-label'], '剩余积分');
  render({ report: { ...enterprise, unlimited: true, total: null, limit: null, used: 1234567.89 }, expanded: true });
  assert.equal(e.get('expanded-total').textContent, '1,234,567.89'); assert.equal(e.get('limit-value').textContent, '不限额');
  assert.equal(e.get('limit-value').style.fontSize, ''); fits();
  render({ report: { ...enterprise, total: 900, limit: 1000, used: 100 }, expanded: true });
  assert.equal(e.get('expanded-total').style.fontSize, '22px'); assert.equal(e.get('limit-value').style.fontSize, '22px');
  assert.equal(e.get('balance-state').hidden, false); assert.equal(e.get('balance-caption').textContent, '积分');
  render({ report, expanded: true });
  assert.equal(e.get('expanded-total').style.fontSize, ''); assert.equal(e.get('limit-value').style.fontSize, '');
  assert.equal(e.get('balance-state').hidden, false); assert.equal(e.get('balance-caption').textContent, '剩余积分');
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
  assert.match(html, /id="balance-caption"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.equal((html.match(/id="expanded-total"/g) || []).length, 1);
  for (const id of ['metric-label', 'limit-cell', 'limit-label', 'limit-value']) assert.ok(html.includes(`id="${id}"`));
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
