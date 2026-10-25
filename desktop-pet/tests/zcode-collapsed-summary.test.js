const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
    assert.equal(nodes.summary.textContent, 'Z额度100%');
    assert.equal(nodes.summary.children[0].children[0].textContent, 'Z');
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
  assert.equal(nodes.summary.textContent, 'Codex5h15%');
  assert.equal(nodes['quota-label'].attributes['aria-label'], 'Codex 剩余额度');
});
