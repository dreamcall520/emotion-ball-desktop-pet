const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function renderer() {
  let receive, unload;
  const animations = [];
  const nodes = Object.fromEntries(['notice', 'brand', 'text', 'dot', 'weather-icon'].map(id => [id, { textContent: '' }]));
  nodes['weather-icon'].removeAttribute = name => { delete nodes['weather-icon'][name]; };
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

test('ZCode quota keeps its own brand and real short model without credit terminology', () => {
  const { receive, nodes } = renderer();
  receive({ id: 1, kind: 'quota', sourceId: 'zcode', model: 'GLM-5.3-Flash', period: '5.3 Flash', remaining: 100, statusLabel: '' });
  assert.equal(nodes.brand.textContent, 'ZCode');
  assert.equal(nodes.text.textContent, '5.3 Flash · 剩余 100%');
  assert.doesNotMatch(nodes.text.textContent, /积分|Codex/);
  receive({ id: 2, kind: 'quota', sourceId: 'codex', period: '周额度', remaining: 79, statusLabel: '' });
  assert.equal(nodes.brand.textContent, 'Codex'); assert.equal(nodes.text.textContent, '周额度 · 剩余 79%');
});

test('WorkBuddy capsules show branded exact credits or expiry without Codex percentages and status', () => {
  const { receive, nodes, document, animations } = renderer();
  receive({ id: 1, kind: 'workbuddy', side: 'right', appearance: 'dark', text: '还剩7,399.91积分', total: 7399.91 });
  assert.equal(nodes.brand.textContent, 'WorkBuddy'); assert.equal(nodes.text.textContent, '还剩7,399.91积分');
  assert.equal(document.body.dataset.kind, 'workbuddy'); assert.equal(document.body.dataset.side, 'right');
  receive({ id: 1, kind: 'workbuddy', text: '99.91积分将于10/28到期', remaining: 0, statusLabel: '已用尽' });
  assert.equal(nodes.text.textContent, '99.91积分将于10/28到期'); assert.equal(animations.length, 2);
});


test('weather edge text uses a static night icon and compact real temperature without changing ordinary text', () => {
  const { receive, nodes, document } = renderer();
  receive({ id: 9, kind: 'text', side: 'right', appearance: 'dark', text: '夜里凉，出门加件衣服。', weather: { code: 2, isDay: false, temperature: 9.7 } });
  assert.equal(document.body.dataset.weather, 'true'); assert.equal(nodes.brand.textContent, '10°');
  assert.equal(nodes.text.textContent, '夜里凉，出门加件衣服。'); assert.equal(nodes.dot.hidden, true);
  assert.equal(nodes['weather-icon'].src, 'assets/weather/meteocons/static/partly-cloudy-night.svg');
  assert.equal(nodes['weather-icon'].hidden, false);
  receive({ id: 10, kind: 'text', text: '你忙，我在边边陪着。' });
  assert.equal(document.body.dataset.weather, 'false'); assert.equal(nodes.brand.textContent, '');
  assert.equal(nodes.dot.hidden, false); assert.equal(nodes['weather-icon'].hidden, true);
  assert.equal(nodes['weather-icon'].src, undefined);
});

test('weather projection rejects untrusted values and maps WMO codes only to vendored static icons', () => {
  const { weatherView } = require('../edge-notice-renderer');
  const valid = { code: 3, isDay: 1, temperature: 0 }, text = '天凉啦，注意保暖。';
  assert.equal(weatherView(valid, text).label, '0°');
  assert.equal(weatherView({ ...valid, temperature: null }, text).label, '天气');
  assert.equal(weatherView({ ...valid, temperature: -5 }, text).label, '-5°');
  assert.equal(weatherView(valid, text).icon, 'assets/weather/meteocons/static/overcast.svg');
  for (const patch of [{ code: '../clear-day' }, { code: 999 }, { code: '3' }, { isDay: 'false' }, { isDay: null }, { temperature: '10' }, { temperature: Infinity }, { temperature: -101 }, { temperature: 71 }]) assert.equal(weatherView({ ...valid, ...patch }, text), null);
  for (const value of [null, '', '字'.repeat(29), '天气\n变化', {}]) assert.equal(weatherView(valid, value), null);
  assert.equal(weatherView([], text), null);
  for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]) for (const isDay of [true, false]) {
    const projection = weatherView({ ...valid, code, isDay }, text);
    assert(fs.existsSync(path.resolve(__dirname, '..', projection.icon)), projection.icon);
    assert.match(projection.icon, /^assets\/weather\/meteocons\/static\/[a-z-]+\.svg$/);
  }
});
