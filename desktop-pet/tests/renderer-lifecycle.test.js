const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 运行真实 renderer、状态规则和动画引擎；仅替代 DOM、宿主通信及时间。
function createRenderer(randomValue = 0.5) {
  let now = 0;
  let nextTimer = 1;
  let engine;
  let captured = false;
  const timers = new Map();
  const events = {};
  const subscriptions = {};
  const host = { bounces: 0, stops: 0, scenes: [] };
  const pet = {
    dataset: {},
    classList: { add() {}, remove() {} },
    style: { setProperty() {} },
    replaceChildren() {},
    addEventListener(name, callback) { events[name] = callback; },
    getBoundingClientRect() { return { x: 0, y: 0, width: 80, height: 80 }; },
    setPointerCapture() { captured = true; },
    hasPointerCapture() { return captured; },
    releasePointerCapture() { captured = false; }
  };
  const subscribe = name => callback => {
    subscriptions[name] = callback;
    return () => { delete subscriptions[name]; };
  };
  const context = vm.createContext({
    console,
    Math: Object.assign(Object.create(Math), { random: () => randomValue }),
    performance: { now: () => now },
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    clearInterval() {},
    requestAnimationFrame() { return 1; },
    document: { getElementById: () => pet },
    innerWidth: 80,
    addEventListener() {},
    petDesktop: {
      beginDrag() {}, dragTo() {}, endDrag() {}, showContextMenu() {},
      bounce() { host.bounces++; },
      stopMotion() { host.stops++; },
      say(scene) { host.scenes.push(scene); },
      onCommand: subscribe('command'),
      onActivity: subscribe('activity'),
      onSettings: subscribe('settings')
    },
    EmotionBall: { createBall: () => ({ applyPose() {}, destroy() {}, burst() {} }) }
  });
  context.window = context;
  const run = file => vm.runInContext(
    fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8'),
    context,
    { filename: file }
  );
  for (const file of [
    'emotion-ball/js/rings.js', 'emotion-ball/js/emotions.js', 'emotion-ball/js/engine.js',
    'desktop-pet/lib/pet-behavior.js', 'desktop-pet/lib/companion-behavior.js'
  ]) run(file);
  const create = context.EmotionBall.create;
  context.EmotionBall.create = (...args) => (engine = create(...args));
  run('desktop-pet/renderer.js');

  function activity(locked = false) {
    subscriptions.activity({
      cursor: { x: 140, y: 140 },
      petBounds: { x: 100, y: 100, width: 80, height: 80 },
      sameDisplay: true, idleSeconds: locked ? null : 0, locked
    });
  }
  activity();
  return {
    host, pet, engine, activity,
    command: value => subscriptions.command(value),
    click() {
      const event = { screenX: 140, screenY: 140, button: 0, pointerId: 1 };
      events.pointerdown(event);
      events.pointerup(event);
    },
    advanceTo(target) {
      assert.ok(target >= now);
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].callback();
      }
      now = target;
      if (engine._active) engine._tick(now);
    }
  };
}

test('锁屏取消待执行单击，不在锁屏后启动动作', () => {
  const renderer = createRenderer();
  renderer.click();
  renderer.advanceTo(100);
  renderer.activity(true);
  renderer.advanceTo(300);
  assert.equal(renderer.engine.emotionId, '00');
  assert.equal(renderer.engine._active, false);
  assert.equal(renderer.engine._spin, null);
  assert.equal(renderer.host.bounces, 0);
  assert.equal(renderer.pet.dataset.lastAction, undefined);
  assert.equal(renderer.host.scenes.includes('play'), false);
});

test('锁屏取消的单击在很快解锁后也不补发', () => {
  const renderer = createRenderer();
  renderer.click();
  renderer.advanceTo(100);
  renderer.activity(true);
  renderer.advanceTo(150);
  renderer.activity(false);
  renderer.advanceTo(300);
  assert.equal(renderer.pet.dataset.lastAction, undefined);
  assert.equal(renderer.engine._spin, null);
  assert.equal(renderer.host.bounces, 0);
  assert.equal(renderer.host.scenes.includes('play'), false);
});

for (const [action, randomValue] of [['bounce', 0.1], ['spin', 0.5]]) {
  test(`锁屏后迟到的 again 命令不能触发 ${action}`, () => {
    const renderer = createRenderer(randomValue);
    renderer.activity(true);
    renderer.command('again');
    renderer.advanceTo(300);
    assert.equal(renderer.engine.emotionId, '00');
    assert.equal(renderer.engine._active, false);
    assert.equal(renderer.engine._spin, null);
    assert.equal(renderer.host.bounces, 0);
    assert.equal(renderer.pet.dataset.lastAction, undefined);
  });
}

test('真实 renderer 的 rest 接线停止引擎自旋并通知宿主停跳', () => {
  const renderer = createRenderer();
  renderer.command('again');
  renderer.advanceTo(100);
  assert.ok(renderer.engine._spin);
  const stopsBeforeRest = renderer.host.stops;
  renderer.command('rest');
  renderer.advanceTo(200);
  assert.equal(renderer.engine.emotionId, '50');
  assert.equal(renderer.engine._spin, null);
  assert.equal(renderer.engine._lastPose.body.yaw, 0);
  assert.equal(renderer.host.stops, stopsBeforeRest + 1);
  assert.equal(renderer.pet.dataset.lastAction, 'rest');
});

test('动作还没结束时再来一次，应启动新的自旋和表情时间线', () => {
  const renderer = createRenderer();
  renderer.command('again');
  renderer.advanceTo(100);
  const firstSpin = renderer.engine._spin;
  const firstStart = renderer.engine._emoStart;
  assert.ok(firstSpin);
  renderer.command('again');
  assert.notEqual(renderer.engine._spin, firstSpin);
  assert.ok(renderer.engine._emoStart > firstStart);
  assert.equal(renderer.engine._spin.x, 0);
});

test('你歇会儿取消排队单击，不会过一会儿又开始玩', () => {
  const renderer = createRenderer();
  renderer.command('again');
  renderer.advanceTo(100);
  renderer.click();
  renderer.command('rest');
  renderer.advanceTo(400);
  assert.equal(renderer.engine.emotionId, '50');
  assert.equal(renderer.engine._spin, null);
  assert.equal(renderer.pet.dataset.lastAction, 'rest');
});
