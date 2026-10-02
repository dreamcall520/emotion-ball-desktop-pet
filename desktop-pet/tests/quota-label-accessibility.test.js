const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function renderer() {
  let receive;
  const element = () => ({
    dataset: {}, children: [], attributes: {}, _text: '',
    set textContent(value) { this._text = String(value); this.children = []; },
    get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this._text; },
    replaceChildren(...children) { this._text = ''; this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; }
  });
  const nodes = Object.fromEntries(['quota-label', 'status', 'summary', 'items', 'overflow',
    'reset-time', 'reset-credits', 'compact-product', 'compact-period', 'secondary-quota',
    'secondary-period', 'secondary-value', 'secondary-progress', 'secondary-reset',
    'extra-credits', 'credits-balance', 'credits-unit'].map(id => [id, element()]));
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../quota-label-renderer.js'), 'utf8'), {
    document: { documentElement: element(), getElementById: id => nodes[id], createElement: element },
    window: { addEventListener() {}, petQuotaLabel: { onModel(callback) { receive = callback; } } }
  });
  return { nodes, receive };
}
const item = (remaining, windowMinutes = 300) => ({ label: 'Codex', remaining, windowMinutes });

test('点数按原字符串准确格式化，明确零与未知/无限/过期分开，缺失不加内容或推断套餐', () => {
  const { nodes, receive } = renderer();
  const show = (extraCredits, state = 'ready', remaining = 79) => receive({ state, size: 'compact',
    expanded: true, items: [item(remaining, 10080)], resetCreditsAvailable: 2, extraCredits });
  for (const [balance, expected] of [['62485.1547310000', '62,485.15'], ['0', '0.00'],
    ['0.000001', '<0.01'], ['12345678901234567890.125', '12,345,678,901,234,567,890.13']]) {
    show({ state: 'balance', balance });
    assert.equal(nodes['credits-balance'].textContent, expected);
    assert.equal(nodes['credits-unit'].textContent, '点');
    assert.equal(nodes['credits-unit'].hidden, false);
    assert.equal(nodes['compact-product'].textContent, 'CODEX');
    assert.equal(nodes['reset-credits'].textContent, '2 次重置机会');
    assert.equal(nodes.summary.textContent, '周额度79%');
  }
  for (const [state, expected] of [['none', '暂无额外点数'], ['unlimited', '不限额'], ['unknown', '暂不可用']]) {
    show({ state }); assert.equal(nodes['credits-balance'].textContent, expected);
    assert.equal(nodes['credits-unit'].hidden, true);
  }
  show({ state: 'balance', balance: '62485.15', usageStatus: 'blocked' }, 'stale');
  assert.equal(nodes['credits-balance'].textContent, '暂不可用');
  assert.match(nodes['extra-credits'].title, /已过期/);
  show({ state: 'balance', balance: '62485.15', usageStatus: 'blocked' });
  assert.equal(nodes.summary.textContent, '周受限79%');
  assert.equal(nodes.items.children[0].children.at(-1).textContent, '已达花费限制');
  show({ state: 'balance', balance: '62485.15' }, 'ready', 0);
  assert.equal(nodes.items.children[0].children.at(-1).textContent, '套餐额度已用尽');
  show(undefined);
  assert.equal(nodes['quota-label'].dataset.hasExtraCredits, 'false');
  assert.equal(nodes['compact-product'].textContent, 'CODEX');
  assert.equal(nodes['credits-balance'].textContent, '');
  assert.equal(nodes.items.children[0].children.length, 4);
});

test('主副周期分别用文字说明低额度，正常额度不出现警告', () => {
  const { nodes, receive } = renderer();
  for (const [remaining, label] of [[20, '偏低'], [15, '偏低'], [10, '紧张'], [5, '紧张'], [0, '已用尽']]) {
    receive({ state: 'ready', expanded: true, items: [item(74, 10080), item(remaining)] });
    assert.equal(nodes['secondary-value'].textContent, `${remaining}%${label}`);
    assert.equal(nodes.items.children[0].children[2].textContent, '74%');
    assert.equal(nodes.items.children[1].children[2].textContent, `${remaining}%${label}`);
    assert.equal(nodes['secondary-progress'].attributes['aria-valuetext'], `${remaining}%，${label}`);
  }
  receive({ state: 'ready', items: [item(21), item(100, 10080)] });
  assert.equal(nodes.items.children[0].children[2].textContent, '21%');
  assert.equal(nodes['secondary-value'].textContent, '100%');
});

test('小巧摘要的颜色和状态只描述实际显示的周期，另一周期低额度不误染主数字', () => {
  const { nodes, receive } = renderer();
  receive({ state: 'ready', size: 'compact', items: [item(74, 10080), item(15)] });
  assert.equal(nodes.summary.dataset.severity, 'normal');
  assert.equal(nodes.summary.textContent, '周额度74%');
  assert.equal(nodes['quota-label'].dataset.severity, 'low');
  receive({ state: 'ready', size: 'compact', items: [item(15), item(74, 10080)] });
  assert.equal(nodes.summary.dataset.severity, 'low');
  assert.equal(nodes.summary.textContent, '5h偏低15%');
  receive({ state: 'ready', size: 'compact', items: [item(0), item(74, 10080)] });
  assert.equal(nodes.summary.dataset.severity, 'urgent');
  assert.equal(nodes.summary.textContent, '5h已用尽0%');
  receive({ state: 'disconnected', items: [] });
  assert.equal(nodes.summary.dataset.severity, 'normal');
  assert.equal(nodes['secondary-value'].textContent, '');
});
