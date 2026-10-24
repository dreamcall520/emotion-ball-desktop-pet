const test = require('node:test');
const assert = require('node:assert/strict');
const { createRotation } = require('../lib/christmas-buddy-rotation');

test('六状态打乱轮转含空场，1000轮均不连续重复，55–65分钟边界完整', () => {
  let seed = 12024, previous;
  const rotation = createRotation(() => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296));
  for (let round = 0; round < 1000; round++) {
    const states = [];
    for (let i = 0; i < 6; i++) {
      const next = rotation.next();
      assert.notEqual(next, previous); states.push(next); previous = next;
      const delay = rotation.delay(); assert.ok(delay >= 3300000 && delay <= 3900000);
    }
    assert.equal(new Set(states).size, 6); assert.ok(states.includes(null));
  }
  assert.equal(createRotation(() => 0).delay(), 3300000);
  assert.equal(createRotation(() => 1 - Number.EPSILON).delay(), 3900000);
});

test('点击严格10%门槛与成功更换10分钟间隔；概率落空不消耗间隔', () => {
  let value = .099999, draws = 0;
  const rotation = createRotation(() => { draws++; return value; });
  assert.equal(rotation.shouldSwitchOnClick(0), true);
  assert.equal(rotation.shouldSwitchOnClick(599999), false); assert.equal(draws, 1);
  value = .1; assert.equal(rotation.shouldSwitchOnClick(600000), false);
  value = 0; assert.equal(rotation.shouldSwitchOnClick(600001), true);
  assert.equal(rotation.shouldSwitchOnClick(1200000), false);
  assert.equal(rotation.shouldSwitchOnClick(1200001), true);
  let accepted = 0;
  for (let i = 0; i < 1000; i++) if (createRotation(() => (i + .5) / 1000).shouldSwitchOnClick(0)) accepted++;
  assert.equal(accepted, 100);
});


test('候选可以只读预检，加载成功再提交状态和点击冷却',()=>{
  const rotation=createRotation(()=>0);
  assert.equal(rotation.next(false),'reindeer');assert.equal(rotation.next(false),'reindeer');
  assert.equal(rotation.next(),'reindeer');assert.equal(rotation.next(false),null);
  assert.equal(rotation.shouldSwitchOnClick(0,false),true);
  assert.equal(rotation.shouldSwitchOnClick(1,false),true);rotation.markClickSwitch(1);
  assert.equal(rotation.shouldSwitchOnClick(600000,false),false);
  assert.equal(rotation.shouldSwitchOnClick(600001,false),true);
});
