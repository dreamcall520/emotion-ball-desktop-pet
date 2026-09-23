const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function renderer() {
  let receive, unload;
  const animations = [];
  const nodes = Object.fromEntries(['notice', 'brand', 'text'].map(id => [id, { textContent: '' }]));
  nodes.notice.classList = { remove: value => animations.push(['remove', value]), add: value => animations.push(['add', value]) };
  const document = { documentElement: { dataset: {} }, body: { dataset: {} }, getElementById: id => nodes[id] };
  const unsubscribe = () => {};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../edge-notice-renderer.js'), 'utf8'), {
    document,
    window: { edgeNotice: { onUpdate(callback) { receive = callback; return unsubscribe; } },
      addEventListener(event, callback) { if (event === 'beforeunload') unload = callback; } }
  });
  assert.equal(unload, unsubscribe);
  return { receive, nodes, document, animations };
}

test('edge quota renders explicit state words while the normal message remains concise', () => {
  const { receive, nodes, document } = renderer();
  for (const side of ['left', 'right']) for (const appearance of ['light', 'dark', 'system']) {
    for (const [remaining, statusLabel, suffix] of [
      [74, '', ''], [20, '偏低', ' · 偏低'], [10, '紧张', ' · 紧张'], [0, '已用尽', ' · 已用尽'],
      [20, '', ''], [10, '偏低', ' · 偏低'], [0, '紧张', ' · 紧张']
    ]) {
      receive({ id: 1, kind: 'quota', side, appearance, period: '周额度', remaining, statusLabel });
      assert.equal(nodes.brand.textContent, 'Codex');
      assert.equal(nodes.text.textContent, `周额度 · 剩余 ${remaining}%${suffix}`);
      assert.equal(document.body.dataset.side, side);
      assert.equal(document.documentElement.dataset.appearance, appearance);
    }
  }
});

test('state refresh does not replay the appearance animation or leak into interaction text', () => {
  const { receive, nodes, document, animations } = renderer();
  const quota = { id: 1, kind: 'quota', side: 'left', period: '5 小时', remaining: 20, statusLabel: '偏低' };
  receive(quota);
  receive({ ...quota, remaining: 10, statusLabel: '紧张' });
  assert.equal(nodes.text.textContent, '5 小时 · 剩余 10% · 紧张');
  assert.equal(animations.length, 2);
  receive({ id: 2, kind: 'text', side: 'right', text: '你忙，我在边边陪着。' });
  assert.equal(nodes.brand.textContent, '');
  assert.equal(nodes.text.textContent, '你忙，我在边边陪着。');
  assert.equal(document.body.dataset.kind, 'text');
  assert.equal(animations.length, 4);
});

test('legacy or unknown state values do not fabricate a low-balance label from rounded percentages', () => {
  const { receive, nodes } = renderer();
  for (const statusLabel of [undefined, 'normal', '<b>偏低</b>']) {
    receive({ id: 1, kind: 'quota', side: 'left', period: '5 小时', remaining: 0, statusLabel });
    assert.equal(nodes.text.textContent, '5 小时 · 剩余 0%');
  }
});
