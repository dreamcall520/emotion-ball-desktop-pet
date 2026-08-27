const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { CompanionState, PettingTracker } = require('../lib/companion-behavior');

function sample(overrides = {}) {
  return {
    idleSeconds: 10, cursor: { x: 100, y: 100 }, sameDisplay: true,
    petBounds: { x: 400, y: 300, width: 100, height: 100 }, locked: false,
    ...overrides
  };
}

function stroke(tracker, start = 0, overrides = {}) {
  return [[10, 0], [30, 200], [10, 400], [40, 650]].map(([x, elapsed]) =>
    tracker.update({ x, y: 20, width: 100, height: 100, ...overrides }, start + elapsed));
}

test('陪伴状态与摸头规则模块存在', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '../lib/companion-behavior.js')), true);
});

test('浏览器无需 Node 也能使用两种规则', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/companion-behavior.js'), 'utf8'), context);
  assert.equal(typeof context.window.CompanionBehavior.CompanionState, 'function');
  assert.equal(typeof context.window.CompanionBehavior.PettingTracker, 'function');
});

test('启动默认安静清醒且不主动欢迎', () => {
  const state = new CompanionState();
  assert.equal(state.manualSleep, false);
  assert.deepEqual(state.update(sample(), 0), { mode: 'awake', emotionId: '50', welcome: false, gaze: null });
});

test('空闲时间在 300、600、900 秒准确转换', () => {
  const state = new CompanionState();
  for (const [idleSeconds, mode, emotionId] of [
    [299.9, 'awake', '50'], [300, 'spacing', '04'], [599.9, 'spacing', '04'],
    [600, 'tired', '15'], [899.9, 'tired', '15'], [900, 'sleep', '00']
  ]) {
    const result = state.update(sample({ idleSeconds }), idleSeconds * 1000);
    assert.equal(result.mode, mode);
    assert.equal(result.emotionId, emotionId);
  }
});

test('启动时没有本地互动不会抵消真实系统空闲', () => {
  assert.equal(new CompanionState().update(sample({ idleSeconds: 900 }), 0).mode, 'sleep');
});

test('有效空闲取系统与本地互动时间的较小值', () => {
  const state = new CompanionState();
  state.noteInteraction(1000);
  assert.equal(state.update(sample({ idleSeconds: 9999 }), 1000).mode, 'awake');
  assert.equal(state.update(sample({ idleSeconds: 9999 }), 300999).mode, 'awake');
  assert.equal(state.update(sample({ idleSeconds: 9999 }), 301000).mode, 'spacing');
  assert.equal(state.update(sample({ idleSeconds: 1 }), 1000000).mode, 'awake');
});

test('持续输入不会随着应用运行时间累积成睡眠', () => {
  const state = new CompanionState();
  for (let now = 0; now <= 1200000; now += 1000) {
    assert.ok(['awake', 'focus'].includes(state.update(sample({ idleSeconds: 0 }), now).mode));
  }
  assert.equal(state.update(sample({ idleSeconds: 0 }), 1201000).mode, 'focus');
});

test('输入持续四秒且鼠标静止三秒后才专注', () => {
  const state = new CompanionState();
  for (const now of [0, 1000, 3000, 3999]) {
    assert.equal(state.update(sample({ idleSeconds: 2 }), now).mode, 'awake');
  }
  assert.equal(state.update(sample({ idleSeconds: 2 }), 4000).mode, 'focus');
  assert.equal(state.update(sample({ idleSeconds: 2 }), 4001).emotionId, '16');
  assert.equal(state.update(sample({ idleSeconds: 0, cursor: { x: 101, y: 100 } }), 4100).mode, 'awake');
  assert.equal(state.update(sample({ idleSeconds: 0, cursor: { x: 101, y: 100 } }), 7099).mode, 'awake');
  assert.equal(state.update(sample({ idleSeconds: 0, cursor: { x: 101, y: 100 } }), 7100).mode, 'focus');
});

test('系统输入中断后重新计算连续工作时长', () => {
  const state = new CompanionState();
  state.update(sample({ idleSeconds: 0 }), 0);
  state.update(sample({ idleSeconds: 3 }), 3000);
  state.update(sample({ idleSeconds: 0 }), 4000);
  assert.equal(state.update(sample({ idleSeconds: 0 }), 7999).mode, 'awake');
  assert.equal(state.update(sample({ idleSeconds: 0 }), 8000).mode, 'focus');
});

test('非法或未知系统空闲退回安全清醒', () => {
  for (const idleSeconds of [null, undefined, NaN, Infinity, -1, '900']) {
    const state = new CompanionState();
    state.update(sample({ idleSeconds: 1000 }), 0);
    assert.equal(state.update(sample({ idleSeconds }), 1000000).mode, 'awake');
  }
});

test('保持清醒跳过自动休息但不覆盖锁屏与手动睡眠', () => {
  const state = new CompanionState({ keepAwake: true });
  assert.equal(state.update(sample({ idleSeconds: 9999 }), 0).mode, 'awake');
  assert.equal(state.update(sample({ idleSeconds: 9999, locked: true }), 1000).mode, 'sleep');
  state.setManualSleep(true, 2000);
  state.noteInteraction(2001);
  assert.equal(state.manualSleep, true);
  assert.equal(state.update(sample({ idleSeconds: null }), 2002).mode, 'sleep');
  state.setManualSleep(false, 3000);
  state.setKeepAwake(false);
  assert.equal(state.update(sample({ idleSeconds: 9999 }), 3000).mode, 'awake');
  assert.equal(state.update(sample({ idleSeconds: 9999 }), 903000).mode, 'sleep');
});

test('自动休息后只在回到清醒的转换瞬间欢迎一次', () => {
  for (const idleSeconds of [300, 600, 900]) {
    const state = new CompanionState();
    assert.equal(state.update(sample({ idleSeconds }), 0).welcome, false);
    assert.equal(state.update(sample({ idleSeconds: 0 }), 1000).welcome, true);
    assert.equal(state.update(sample({ idleSeconds: 0 }), 2000).welcome, false);
    assert.equal(state.update(sample({ idleSeconds: 0 }), 5000).welcome, false);
  }
});

test('手动唤醒重置空闲且不重复欢迎', () => {
  const state = new CompanionState();
  state.update(sample({ idleSeconds: 900 }), 0);
  state.setManualSleep(true, 1000);
  state.update(sample({ idleSeconds: 900 }), 1000);
  state.setManualSleep(false, 2000);
  assert.equal(state.manualSleep, false);
  const result = state.update(sample({ idleSeconds: 900 }), 2000);
  assert.equal(result.mode, 'awake');
  assert.equal(result.welcome, false);
  assert.equal(state.update(sample({ idleSeconds: 0 }), 3000).welcome, false);
});

test('视线仅在实际鼠标移动后按宠物中心归一化', () => {
  const state = new CompanionState();
  assert.equal(state.update(sample(), 0).gaze, null);
  assert.deepEqual(state.update(sample({ cursor: { x: 570, y: 250 } }), 1000).gaze, { x: 0.5, y: -0.5 });
  assert.deepEqual(state.update(sample({ cursor: { x: 10000, y: -10000 } }), 2000).gaze, { x: 1, y: -1 });
});

test('大尺寸视线按两倍宠物尺寸缩放', () => {
  const state = new CompanionState();
  state.update(sample(), 0);
  assert.deepEqual(state.update(sample({
    petBounds: { x: 0, y: 0, width: 300, height: 200 }, cursor: { x: 450, y: 300 }
  }), 100).gaze, { x: 0.5, y: 0.5 });
});

test('鼠标静止超过 2.5 秒、跨屏或睡眠均停止看鼠标', () => {
  const state = new CompanionState();
  state.update(sample(), 0);
  const moved = sample({ cursor: { x: 200, y: 200 } });
  assert.notEqual(state.update(moved, 1000).gaze, null);
  assert.equal(state.update(moved, 3501).gaze, null);
  assert.equal(state.update(sample({ sameDisplay: false, cursor: { x: -500, y: 200 } }), 4000).gaze, null);
  assert.equal(state.update(sample({ idleSeconds: 900, cursor: { x: 250, y: 200 } }), 5000).gaze, null);
});

test('缺少可靠鼠标或宠物尺寸时不生成视线', () => {
  const state = new CompanionState();
  state.update(sample(), 0);
  assert.equal(state.update(sample({ cursor: null }), 1000).gaze, null);
  assert.equal(state.update(sample({ cursor: { x: NaN, y: 100 } }), 2000).gaze, null);
  assert.equal(state.update(sample({ petBounds: null, cursor: { x: 200, y: 200 } }), 3000).gaze, null);
});

test('摸头持续 650 毫秒且距离足够才触发', () => {
  assert.deepEqual(stroke(new PettingTracker()), [false, false, false, true]);
});

test('快速掠过和短距离停留都不算摸头', () => {
  const fast = new PettingTracker();
  assert.equal(fast.update({ x: 0, y: 20, width: 100, height: 100 }, 0), false);
  assert.equal(fast.update({ x: 90, y: 20, width: 100, height: 100 }, 100), false);
  assert.equal(fast.update({ x: 90, y: 20, width: 100, height: 100 }, 800), false);
  const slow = new PettingTracker();
  for (const [x, now] of [[10, 0], [11, 200], [12, 400], [13, 650]]) {
    assert.equal(slow.update({ x, y: 20, width: 100, height: 100 }, now), false);
  }
});

test('离开头顶或宠物横向边界会结束本轮摸头', () => {
  for (const outside of [{ x: 30, y: 43 }, { x: -1, y: 20 }, { x: 101, y: 20 }]) {
    const tracker = new PettingTracker();
    tracker.update({ x: 10, y: 20, width: 100, height: 100 }, 0);
    tracker.update({ x: 60, y: 20, width: 100, height: 100 }, 300);
    assert.equal(tracker.update({ ...outside, width: 100, height: 100 }, 400), false);
    assert.deepEqual(stroke(tracker, 500), [false, false, false, true]);
  }
});

test('按住按钮和拖动不能触发摸头', () => {
  const tracker = new PettingTracker();
  assert.deepEqual(stroke(tracker, 0, { buttons: 1 }), [false, false, false, false]);
  assert.deepEqual(stroke(tracker, 700), [false, false, false, true]);
});

test('静止会重新计算连续移动时长', () => {
  const tracker = new PettingTracker();
  tracker.update({ x: 10, y: 20, width: 100, height: 100 }, 0);
  tracker.update({ x: 10, y: 20, width: 100, height: 100 }, 500);
  assert.equal(tracker.update({ x: 90, y: 20, width: 100, height: 100 }, 650), false);
});

test('仅收到移动事件时也不能把停留时间算作摸头', () => {
  const tracker = new PettingTracker();
  tracker.update({ x: 10, y: 20, width: 100, height: 100 }, 0);
  assert.equal(tracker.update({ x: 90, y: 20, width: 100, height: 100 }, 650), false);
});

test('较慢的连续抚摸允许五百毫秒采样间隔', () => {
  const tracker = new PettingTracker();
  assert.equal(tracker.update({ x: 10, y: 20, width: 100, height: 100 }, 0), false);
  assert.equal(tracker.update({ x: 40, y: 20, width: 100, height: 100 }, 500), false);
  assert.equal(tracker.update({ x: 10, y: 20, width: 100, height: 100 }, 1000), true);
});

test('两秒以外的手势距离不能累积', () => {
  const tracker = new PettingTracker();
  for (let step = 0; step < 8; step += 1) {
    tracker.update({ x: 10 + step, y: 20, width: 100, height: 100 }, step * 250);
  }
  assert.equal(tracker.update({ x: 80, y: 20, width: 100, height: 100 }, 2001), false);
});

test('触发后冷却六秒且 reset 不清除冷却', () => {
  const tracker = new PettingTracker();
  assert.deepEqual(stroke(tracker), [false, false, false, true]);
  tracker.reset();
  assert.deepEqual(stroke(tracker, 1000), [false, false, false, false]);
  assert.equal(tracker.update({ x: 10, y: 20, width: 100, height: 100 }, 6649), false);
  assert.deepEqual(stroke(tracker, 6650), [false, false, false, true]);
});
