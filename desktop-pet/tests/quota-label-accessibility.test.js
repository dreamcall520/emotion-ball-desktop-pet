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
    'secondary-period', 'secondary-value', 'secondary-progress', 'secondary-reset'].map(id => [id, element()]));
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../quota-label-renderer.js'), 'utf8'), {
    document: { documentElement: element(), getElementById: id => nodes[id], createElement: element },
    window: { addEventListener() {}, petQuotaLabel: { onModel(callback) { receive = callback; } } }
  });
  return { nodes, receive };
}
const item = (remaining, windowMinutes = 300) => ({ label: 'Codex', remaining, windowMinutes });

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
