const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const display = require('../lib/quota-display');
const effects = require('../quota-effects');
const { DEFAULTS, normalizeSettings, saveSettings, loadSettings } = require('../lib/settings');

test('额度展示保留旧卡片偏好，过滤非法选项并持久化新样式', t => {
  assert.deepEqual(display.normalize(undefined, { codexQuotaPeriod: 'weekly', codexQuotaLabelSize: 'standard' }), {
    style: 'card', material: 'soft', period: 'weekly', cardSize: 'standard', showNumbers: true
  });
  for (const raw of [null, [], { style: '<script>', material: 'bad', period: 'bad', cardSize: 'bad', showNumbers: 'true' }]) {
    assert.deepEqual(display.normalize(raw), { style: 'card', material: 'soft', period: 'both', cardSize: 'compact', showNumbers: true });
  }
  assert.equal(DEFAULTS.quotaDisplay.showNumbers, true);
  for (const raw of [{}, { quotaDisplay: { style: 'ring' } }]) assert.equal(normalizeSettings(raw).quotaDisplay.showNumbers, true);
  assert.equal(display.normalize({ showNumbers: false }).showNumbers, false);
  assert.deepEqual(display.periods(display.normalize({ style: 'ring', period: 'weekly' })), ['weekly']);
  for (const style of ['duo', 'split', 'stages']) assert.deepEqual(display.periods(display.normalize({ style })), ['fiveHour', 'weekly']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiuqiu-quota-display-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  const quotaDisplay = { style: 'split', material: 'glass', period: 'both', cardSize: 'compact', showNumbers: true };
  assert.equal(loadSettings(file).quotaDisplay.showNumbers, true);
  fs.writeFileSync(file, JSON.stringify({ quotaDisplay: { style: 'ring' } }));
  assert.equal(loadSettings(file).quotaDisplay.showNumbers, true);
  for (const showNumbers of [true, false]) {
    const value = { ...quotaDisplay, showNumbers };
    saveSettings(file, { uiTheme: 'green', quotaDisplay: value, remaining: 74 });
    assert.deepEqual(loadSettings(file).quotaDisplay, value);
  }
  assert.equal(loadSettings(file).uiTheme, 'green');
  assert.equal(fs.readFileSync(file, 'utf8').includes('remaining'), false);
});

test('额度模型区分零、未知和过期，动效数值限制于百分比范围', () => {
  const items = [{ windowMinutes: 300, remaining: 0 }, { windowMinutes: 10080, remaining: 38 }];
  assert.deepEqual(display.values({ state: 'ready', items }), { fiveHour: 0, weekly: 38 });
  for (const state of ['stale', 'disconnected', 'period-missing']) {
    assert.deepEqual(display.values({ state, items }), { fiveHour: null, weekly: null });
  }
  assert.deepEqual(display.values({ state: 'ready', items: [{ windowMinutes: 300, remaining: null }] }), { fiveHour: null, weekly: null });
  const model = effects.model({ config: { style: 'duo' }, quotas: { fiveHour: -1, weekly: 120 } });
  assert.deepEqual(model.values, { fiveHour: 0, weekly: 100 });
  assert.equal(model.available, true);
  assert.equal(effects.model({ config: { style: 'duo' }, quotas: { fiveHour: 0 } }).style, 'ring');
});

test('新额度样式按实际周期展示，忽略旧手选周期，零有效且不补空位', () => {
  for (const style of display.STYLES) {
    const config = display.normalize({ style, period: 'fiveHour' });
    const weekly = { state: 'ready', items: [{ windowMinutes: 10080, remaining: 90 }] };
    assert.deepEqual(display.periods(config, weekly), ['weekly']);
    assert.deepEqual(display.periods(config, { state: 'disconnected', items: [] }), []);
    const both = { state: 'ready', items: [...weekly.items, { windowMinutes: 300, remaining: 0 }] };
    assert.deepEqual(display.periods(config, both), ['pool', 'ring'].includes(style) ? ['fiveHour'] : ['fiveHour', 'weekly']);
    assert.deepEqual(display.periods(config, { ...weekly, state: 'stale' }), ['weekly']);
  }
});
