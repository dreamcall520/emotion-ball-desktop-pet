const test = require('node:test');
const assert = require('node:assert/strict');
const effects = require('../quota-effects');

test('quota effects automatically use present quotas and keep zero distinct from missing', () => {
  const dual = quotas => effects.model({ config: { style: 'duo' }, quotas });
  assert.equal(dual({ fiveHour: 0, weekly: 0 }).available, true);
  assert.equal(dual({ fiveHour: 74, weekly: null }).style, 'ring');
  assert.equal(dual({ fiveHour: 74, weekly: null }).available, true);
  assert.equal(dual({ fiveHour: null, weekly: null }).available, false);
  assert.deepEqual(dual({ fiveHour: '74', weekly: NaN }).values, { fiveHour: null, weekly: null });
  assert.deepEqual(dual({ fiveHour: -5, weekly: 120 }).values, { fiveHour: 0, weekly: 100 });
  assert.equal(effects.model({ appearance: { shape: 'codex-pet' }, config: { style: 'ring' } }).visible, false);
  assert.equal(effects.model({ visible: false, config: { style: 'pool' } }).visible, false);
  const config = { style: 'split', period: 'weekly' };
  assert.equal(effects.model({ config, quotas: { fiveHour: 0, weekly: 94 } }).period, 'fiveHour');
  const weeklyOnly = effects.model({ config, quotas: { fiveHour: null, weekly: 0 } });
  assert.equal(weeklyOnly.period, 'weekly');
  assert.equal(weeklyOnly.style, 'split');
  assert.equal(weeklyOnly.dual, false);
  assert.equal(weeklyOnly.available, true);
  assert.equal(config.style, 'split');
  assert.equal(effects.model({ config, quotas: { fiveHour: 74, weekly: 94 } }).style, 'split');
  for (const style of ['duo','split','stages']) {
    const single=effects.model({ config: { style }, quotas: { fiveHour: null, weekly: 38 } });
    assert.equal(single.style, style === 'duo' ? 'ring' : style);
    assert.equal(single.dual, false);
    const pair=effects.model({ config: { style }, quotas: { fiveHour: 74, weekly: 38 } });
    assert.equal(pair.style, style);
    assert.equal(pair.dual, true);
  }
});

test('ring palette follows body hue and distinguishes the two quotas', () => {
  for (const bodyColor of ['#EEEBE4','#5B3BC7','#FF7788','#0088FF','#33BB77']) {
    const primary = effects.palette({ bodyColor }), pair = effects.dualPalettes(primary);
    assert.ok(pair.every(p => Object.values(p).flat().every(v => Number.isFinite(v) && v >= 0 && v <= 255)));
    assert.ok(Math.hypot(...pair[0].base.map((v,i) => v-pair[1].base[i])) > 70, bodyColor);
  }
  assert.notDeepEqual(effects.palette({ bodyColor: '#5B3BC7' }).base, effects.palette({ bodyColor: '#0088FF' }).base);
});

test('each of five arcs consumes exactly one fifth of its quota', () => {
  assert.equal(effects.quotaStages(null), null);
  assert.deepEqual(effects.quotaStages(0), [0,0,0,0,0]);
  assert.deepEqual(effects.quotaStages(50), [1,1,.5,0,0]);
  assert.deepEqual(effects.quotaStages(100), [1,1,1,1,1]);
});
