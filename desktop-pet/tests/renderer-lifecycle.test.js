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
  const windowEvents = {};
  const host = { bounces: 0, stops: 0, scenes: [], motions: [], frames: [], positions: [] };
  const bounds = { x: 100, y: 100, width: 80, height: 80 };
  let windowController;
  const nativeWindow = { isDestroyed: () => false, isVisible: () => true,
    getBounds: () => ({ ...bounds }), setPosition(x, y) { bounds.x = x; bounds.y = y; host.positions.push({ x, y }); } };
  function node(tag) {
    return { tag, children: [], attributes: {}, style: {},
      setAttribute(key, value) { this.attributes[key] = String(value); },
      getAttribute(key) { return this.attributes[key]; },
      appendChild(child) { this.children.push(child); child.parentNode = this; },
      removeChild(child) { this.children = this.children.filter(item => item !== child); },
      remove() { this.parentNode?.removeChild(this); }
    };
  }
  const pet = {
    dataset: {},
    classList: { add() {}, remove() {} },
    style: { setProperty() {} },
    children: [],
    appendChild(child) { this.children.push(child); child.parentNode = this; },
    removeChild(child) { this.children = this.children.filter(item => item !== child); },
    replaceChildren() { this.children = []; },
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
    document: { getElementById: () => pet, createElementNS: (_ns, tag) => node(tag) },
    innerWidth: 80,
    addEventListener(name, callback) { windowEvents[name] = callback; },
    petDesktop: {
      beginDrag() { windowController?.stop(); }, dragTo() {}, endDrag() {}, showContextMenu() {},
      bounce() { host.bounces++; },
      stopMotion() { host.stops++; windowController?.stop(); },
      playMotion(request) {
        host.motions.push(request);
        if (!windowController) {
          const { createWindowMotion } = require('../lib/window-motion');
          windowController = createWindowMotion({ getWindow: () => nativeWindow,
            getWorkArea: () => ({ x: 0, y: 0, width: 1000, height: 800 }), now: () => now,
            schedule: context.setTimeout, cancel: context.clearTimeout,
            sendFrame(packet) { host.frames.push(packet); subscriptions.motion(packet); }
          });
        }
        windowController.start(request);
      },
      say(scene) { host.scenes.push(scene); },
      onCommand: subscribe('command'),
      onActivity: subscribe('activity'),
      onSettings: subscribe('settings'),
      onMotion: subscribe('motion')
    }
  });
  context.window = context;
  const run = file => vm.runInContext(
    fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8'),
    context,
    { filename: file }
  );
  for (const file of [
    'emotion-ball/js/rings.js', 'emotion-ball/js/emotions.js', 'emotion-ball/js/ball.js', 'emotion-ball/js/engine.js',
    'desktop-pet/lib/pet-behavior.js', 'desktop-pet/lib/companion-behavior.js', 'desktop-pet/lib/interaction-motion.js'
  ]) run(file);
  const create = context.EmotionBall.create;
  context.EmotionBall.create = (...args) => (engine = create(...args));
  run('desktop-pet/renderer.js');

  function activity(locked = false, overrides = {}) {
    subscriptions.activity({
      cursor: { x: 140, y: 140 },
      petBounds: { x: 100, y: 100, width: 80, height: 80 },
      sameDisplay: true, idleSeconds: locked ? null : 0, locked, ...overrides
    });
  }
  activity();
  return {
    host, pet, get engine() { return engine; }, activity, bounds, events, windowEvents, timers,
    frame: packet => subscriptions.motion(packet),
    stopHost: () => windowController?.stop(),
    resize(width) { context.innerWidth = width; windowEvents.resize(); },
    emotions: context.EmotionBall.config.list(),
    command: value => subscriptions.command(value),
    click() {
      const event = { screenX: 140, screenY: 140, button: 0, pointerId: 1 };
      events.pointerdown(event);
      events.pointerup(event);
    },
    doubleClick() {
      this.click();
      this.click();
      events.dblclick({ button: 0 });
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

test('全部表情及过渡帧保持睡眠灰白，眼睛保持原来的黑色', () => {
  const renderer = createRenderer();
  let now = 0;
  for (const definition of renderer.emotions) {
    renderer.engine.setEmotion(definition.id);
    for (const elapsed of [1, 150, 750, 1600, 3500]) {
      renderer.advanceTo(now + elapsed);
      const pose = renderer.engine._lastPose;
      assert.equal(pose.body.color.toUpperCase(), '#EEEBE4', `${definition.id} / ${elapsed}ms 身体色`);
      assert.equal(pose.left.color.toUpperCase(), '#1A1A1A', `${definition.id} 左眼`);
      assert.equal(pose.right.color.toUpperCase(), '#1A1A1A', `${definition.id} 右眼`);
    }
    now += 3500;
  }
  assert.equal(renderer.emotions.find(definition => definition.id === '10').raw.body.color, '#F6EFE4', '不改原项目的开心配色');
});

for (const [random, action, emotion] of [[0, 'hop', '10'], [0.2, 'jelly', '03'], [0.4, 'sway', '19'], [0.6, 'peek', '03'], [0.8, 'bow', '14'], [0.99, 'spin', '10']]) {
  test(`双击清醒球球会${action}，不会进入睡眠或补发单击`, () => {
    const renderer = createRenderer(random);
    renderer.doubleClick();
    renderer.advanceTo(400);
    assert.equal(renderer.pet.dataset.lastAction, action);
    assert.equal(renderer.engine.emotionId, emotion);
    assert.notEqual(renderer.pet.dataset.mode, 'manual-sleep');
    assert.equal(renderer.host.scenes.includes('sleep'), false);
    assert.equal(renderer.host.scenes.filter(scene => scene?.event === 'play' && scene.motion === action).length, 1);
    assert.equal(renderer.host.motions.length, 1);
    assert.equal(renderer.host.bounces, 0);
    const latest = renderer.host.frames.at(-1);
    assert.ok(latest, '真实宿主控制器应产生身体帧');
    assert.notDeepEqual(latest.frame.body, require('../lib/interaction-motion').sampleMotion(action, 0).body);
    for (const key of Object.keys(latest.frame.body)) assert.equal(renderer.engine._lastPose.body[key], latest.frame.body[key]);
    assert.equal(renderer.engine._lastPose.body.scale, 1);
    const bodyNode = renderer.engine.ball.svg.children.find(child => child.children.some(node => node.attributes.class === 'eb-eye'));
    const round = value => Math.round(value * 100) / 100;
    assert.ok(bodyNode.attributes.transform.includes(`scale(${round(latest.frame.body.scaleX)} ${round(latest.frame.body.scaleY)})`), '真实 SVG 应使用横纵身体缩放');
    assert.equal(renderer.engine._lastPose.body.color, '#EEEBE4');
    renderer.advanceTo(2400);
    assert.equal(renderer.engine._motionFrame, null);
    assert.equal(renderer.engine.emotionId, '50');
    assert.deepEqual(renderer.bounds, { x: 100, y: 100, width: 80, height: 80 });
  });
}

test('连续双击不重复，旧token帧无效；绑定again重播原动作完整时间线', () => {
  const renderer = createRenderer(0);
  renderer.doubleClick();
  renderer.advanceTo(400);
  const first = renderer.host.motions[0];
  renderer.doubleClick();
  renderer.advanceTo(500);
  const second = renderer.host.motions[1];
  assert.ok(first && second, '两次双击均应启动受控身体动作');
  assert.notEqual(second.action, first.action);
  assert.ok(second.token > first.token);
  const before = renderer.engine._motionFrame;
  renderer.frame({ ...first, frame: require('../lib/interaction-motion').sampleMotion(first.action, 1800) });
  assert.equal(renderer.engine._motionFrame, before);
  renderer.command({ command: 'again', motion: first.action });
  assert.equal(renderer.host.motions.at(-1).action, first.action);
  assert.ok(renderer.host.motions.at(-1).token > second.token);
  renderer.advanceTo(540);
  assert.ok(renderer.engine._motionFrame);
  renderer.advanceTo(2308);
  assert.equal(renderer.engine._motionFrame, null);
});

for (const reason of ['rest', 'sleep', 'lock', 'hide', 'resize', 'drag', 'unload']) {
  test(`${reason}打断动作后归位且旧帧和排队单击失效`, () => {
    const renderer = createRenderer(0);
    renderer.doubleClick();
    renderer.advanceTo(400);
    const first = renderer.host.motions[0];
    assert.ok(first);
    const oldEngine = renderer.engine;
    if (reason === 'lock') renderer.activity(true);
    else if (reason === 'hide') { renderer.stopHost(); renderer.command('stop'); }
    else if (reason === 'resize') renderer.windowEvents.resize();
    else if (reason === 'unload') renderer.windowEvents.beforeunload();
    else if (reason === 'drag') {
      renderer.events.pointerdown({ button: 0, pointerId: 1, screenX: 140, screenY: 140 });
      renderer.events.pointermove({ pointerId: 1, screenX: 170, screenY: 170, clientX: 30, clientY: 30, buttons: 1 });
    } else renderer.command(reason);
    if (reason !== 'unload') renderer.frame({ ...first, frame: require('../lib/interaction-motion').sampleMotion('hop', 540) });
    renderer.advanceTo(2600);
    assert.equal(oldEngine._motionFrame, null);
    assert.equal(oldEngine._spin, null);
    assert.equal(renderer.host.motions.length, 1);
    assert.equal(renderer.host.bounces, 0);
    assert.deepEqual(renderer.bounds, { x: 100, y: 100, width: 80, height: 80 });
  });
}

test('受控动作期间招呼计时及无按键摸头不会抢身体动作', () => {
  const renderer = createRenderer(0);
  renderer.doubleClick();
  renderer.events.pointerenter();
  for (let at = 100; at <= 1200; at += 100) {
    renderer.advanceTo(at);
    renderer.events.pointermove({ clientX: at % 200 ? 20 : 60, clientY: 10, buttons: 0 });
  }
  assert.equal(renderer.pet.dataset.lastAction, 'hop');
  assert.equal(renderer.engine.emotionId, '10');
  assert.ok(renderer.engine._motionFrame);
  assert.equal(renderer.host.scenes.length, 1);
});

test('引擎隔离动作字段和对象引用，切换表情不把受控姿态带入过渡', () => {
  const renderer = createRenderer();
  const frame = { body: { x: 2, y: 3, scaleX: 0.9, scaleY: 0.8, rotate: 10, yaw: 1, color: 'red' }, gaze: { x: 5, y: 6 } };
  assert.equal(typeof renderer.engine.setMotionFrame, 'function');
  renderer.engine.setMotionFrame(frame);
  frame.body.y = 99;
  frame.gaze.x = 99;
  renderer.advanceTo(100);
  assert.equal(renderer.engine._lastPose.body.y, 3);
  assert.equal(renderer.engine._lastPose.body.color, '#EEEBE4');
  for (const invalid of [null, {}, { body: { x: Infinity } }, { body: { scaleX: -1 } }, { gaze: { y: NaN } }]) {
    renderer.engine.setMotionFrame(invalid);
    renderer.advanceTo(110);
    assert.equal(renderer.engine._lastPose.body.y, 3);
  }
  renderer.engine.setEmotion('50');
  assert.equal(renderer.engine._motionFrame, null);
  renderer.advanceTo(111);
  assert.equal(renderer.engine._lastPose.body.yaw, 0);
  assert.notEqual(renderer.engine._lastPose.body.y, 3);
});

test('锁屏停止动画循环之前，真实SVG立即回到睡眠姿态', () => {
  const renderer = createRenderer(0.2);
  renderer.doubleClick();
  renderer.advanceTo(220);
  const body = renderer.engine.ball.svg.children.find(child => child.children.some(node => node.attributes.class === 'eb-eye'));
  const animated = body.attributes.transform;
  renderer.activity(true);
  assert.equal(renderer.engine._active, false);
  assert.notEqual(body.attributes.transform, animated, '锁屏不能冻结旧果冻姿态');
  assert.equal(renderer.engine._lastPose.body.yaw, 0);
});

test('跨尺寸档重建后不再接旧token，默认身体缩放和鼠标注视恢复', () => {
  const renderer = createRenderer(0.6);
  renderer.doubleClick();
  renderer.advanceTo(260);
  const original = renderer.engine;
  const oldPacket = renderer.host.frames.at(-1);
  renderer.resize(180);
  assert.notEqual(renderer.engine, original);
  assert.equal(original._motionFrame, null);
  renderer.frame(oldPacket);
  renderer.activity(false, { cursor: { x: 400, y: 140 } });
  renderer.advanceTo(400);
  assert.equal(renderer.engine._motionFrame, null);
  assert.equal(renderer.engine._lastPose.body.yaw, 0);
  assert.ok(renderer.engine._lastPose.left.lookX > 0);
  const body = renderer.engine.ball.svg.children.find(child => child.children.some(node => node.attributes.class === 'eb-eye'));
  const scale = Math.round(renderer.engine._lastPose.body.scale * 100) / 100;
  assert.ok(body.attributes.transform.includes(`scale(${scale} ${scale})`));
});

test('单击不会覆盖双击不连续重复的独立记忆', () => {
  const renderer = createRenderer(0);
  renderer.doubleClick();
  renderer.advanceTo(2000);
  renderer.click();
  renderer.advanceTo(2300);
  assert.equal(renderer.pet.dataset.lastAction, 'bounce');
  renderer.doubleClick();
  assert.equal(renderer.host.motions.at(-1).action, 'jelly');
});

test('相同token但动作不匹配的结束帧不清当前动作；stop不往宿主回传循环', () => {
  const renderer = createRenderer(0);
  renderer.doubleClick();
  renderer.advanceTo(200);
  const packet = renderer.host.frames.at(-1);
  renderer.frame({ ...packet, action: 'bow', frame: { done: true } });
  assert.ok(renderer.engine._motionFrame);
  const stops = renderer.host.stops;
  renderer.command('stop');
  assert.equal(renderer.engine._motionFrame, null);
  assert.equal(renderer.host.stops, stops);
});

test('菜单仍可睡眠，双击睡着的球球只唤醒', () => {
  const renderer = createRenderer();
  renderer.command('sleep');
  renderer.advanceTo(100);
  assert.equal(renderer.pet.dataset.mode, 'manual-sleep');
  renderer.doubleClick();
  renderer.advanceTo(500);
  assert.equal(renderer.pet.dataset.mode, 'awake');
  assert.notEqual(renderer.engine.emotionId, '00');
  assert.equal(renderer.host.scenes.at(-1), 'welcome');
  assert.equal(renderer.host.scenes.includes('play'), false);
});

test('系统空闲睡着后，真实双击序列只唤醒，不被第一次松手提前变醒而误触发动作', () => {
  const renderer = createRenderer(0);
  renderer.activity(false, { idleSeconds: 1000 });
  renderer.advanceTo(100);
  assert.equal(renderer.engine.emotionId, '00');
  renderer.doubleClick();
  renderer.advanceTo(500);
  assert.equal(renderer.host.motions.length, 0);
  assert.equal(renderer.host.bounces, 0);
  assert.equal(renderer.host.scenes.at(-1), 'welcome');
});

test('播放身体动作时菜单立即唤醒会停止旧动作，旧帧不再覆盖欢迎', () => {
  const renderer = createRenderer(0);
  renderer.doubleClick();
  renderer.advanceTo(400);
  const packet = renderer.host.frames.at(-1);
  renderer.command('wake');
  renderer.frame(packet);
  renderer.advanceTo(500);
  assert.equal(renderer.engine._motionFrame, null);
  assert.equal(renderer.engine.emotionId, '01');
  assert.deepEqual(renderer.bounds, { x: 100, y: 100, width: 80, height: 80 });
});

test('锁屏时双击不触发互动', () => {
  const renderer = createRenderer();
  renderer.activity(true);
  renderer.doubleClick();
  renderer.advanceTo(400);
  assert.equal(renderer.engine._active, false);
  assert.equal(renderer.pet.dataset.lastAction, undefined);
  assert.deepEqual(renderer.host.scenes, []);
});
