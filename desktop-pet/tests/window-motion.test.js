const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sampleMotion, getMotion, positionForMotion } = require('../lib/interaction-motion');

const modulePath = path.resolve(__dirname, '../lib/window-motion.js');
function fixture(bounds = { x: -700, y: 40, width: 80, height: 80 }) {
  assert.ok(fs.existsSync(modulePath), '需要统一的窗口与身体动作控制器');
  const { createWindowMotion } = require(modulePath);
  let now = 0;
  let serial = 0;
  const timers = new Map();
  const callbacks = [];
  const frames = [];
  const moves = [];
  const origin = { ...bounds };
  const workArea = { x: -800, y: 0, width: 800, height: 600 };
  const win = {
    destroyed: false, visible: true,
    isDestroyed() { return this.destroyed; },
    isVisible() { return this.visible; },
    getBounds: () => ({ ...bounds }),
    setPosition(x, y, animate) { moves.push({ x, y, animate }); bounds.x = x; bounds.y = y; }
  };
  const controller = createWindowMotion({
    getWindow: () => win, getWorkArea: () => workArea, now: () => now,
    schedule(callback, delay) { callbacks.push(callback); timers.set(++serial, { callback, at: now + delay }); return serial; },
    cancel(id) { timers.delete(id); },
    sendFrame(packet) { frames.push(packet); }
  });
  return { controller, win, frames, moves, callbacks, timers, bounds, origin, workArea,
    at(time) { now = time; const queued = [...timers.values()]; timers.clear(); queued.forEach(item => item.callback()); }
  };
}

test('窗口和身体使用同一帧时间，结束回到原位且释放计时器', () => {
  const f = fixture();
  assert.equal(f.controller.start({ token: 1, action: 'hop' }), true);
  f.at(540);
  assert.deepEqual(f.frames.at(-1), { token: 1, action: 'hop', frame: sampleMotion('hop', 540) });
  assert.deepEqual(f.moves.at(-1), { ...positionForMotion(f.origin, f.workArea, sampleMotion('hop', 540).window), animate: false });
  f.at(getMotion('hop').durationMs);
  assert.deepEqual(f.bounds, f.origin);
  assert.equal(f.frames.at(-1).frame.done, true);
  assert.equal(f.timers.size, 0);
});

test('再次启动使旧回调失效，停止后归位且只通知当前 token', () => {
  const f = fixture();
  f.controller.start({ token: 1, action: 'hop' });
  f.at(540);
  const old = f.callbacks.at(-1);
  f.controller.start({ token: 2, action: 'peek' });
  f.at(800);
  const count = f.frames.length;
  old();
  assert.equal(f.frames.length, count);
  f.controller.stop();
  assert.deepEqual(f.bounds, f.origin);
  assert.equal(f.frames.at(-1).token, 2);
  assert.equal(f.frames.at(-1).frame.done, true);
  const stoppedCount = f.frames.length;
  f.callbacks.at(-1)();
  f.controller.stop();
  assert.equal(f.frames.length, stoppedCount);
});

test('负坐标屏幕边缘会夹紧，人工移动后无恢复停止不会拉回', () => {
  const f = fixture({ x: -800, y: 0, width: 80, height: 80 });
  f.controller.start({ token: 1, action: 'peek' });
  f.at(260);
  assert.equal(f.bounds.x, -800);
  f.bounds.x = -300;
  f.controller.stop({ restore: false, notify: false });
  f.callbacks.at(-1)();
  assert.equal(f.bounds.x, -300);
  assert.equal(f.frames.some(packet => packet.frame.done), false);
});

test('非法输入不启动或终止合法动作，窗口关闭或隐藏后安全清理', () => {
  const f = fixture();
  for (const request of [null, {}, { token: 0, action: 'hop' }, { token: 1.1, action: 'hop' },
    { token: Number.MAX_SAFE_INTEGER + 1, action: 'hop' }, { token: 1, action: '__proto__' }]) {
    assert.equal(f.controller.start(request), false);
  }
  f.win.visible = false;
  assert.equal(f.controller.start({ token: 1, action: 'hop' }), false);
  f.win.visible = true;
  f.controller.start({ token: 1, action: 'hop' });
  assert.equal(f.controller.start({ token: -1, action: 'peek' }), false);
  f.at(540);
  assert.equal(f.frames.at(-1).token, 1);
  f.win.destroyed = true;
  const count = f.frames.length;
  f.at(600);
  assert.equal(f.timers.size, 0);
  assert.equal(f.frames.length, count, '关闭窗口不发送结束帧');
});

test('发送或窗口操作失败不会抛出未捕获异常或遗留计时器', () => {
  const f = fixture();
  f.win.setPosition = () => { throw new Error('window closed'); };
  assert.doesNotThrow(() => f.controller.start({ token: 1, action: 'hop' }));
  assert.equal(f.timers.size, 0);
  const { createWindowMotion } = require(modulePath);
  const controller = createWindowMotion({ getWindow: () => f.win, getWorkArea: () => f.workArea,
    now: () => 0, schedule() { throw new Error('must not schedule after failure'); }, cancel() {},
    sendFrame() { throw new Error('renderer gone'); } });
  f.win.setPosition = () => {};
  assert.doesNotThrow(() => controller.start({ token: 2, action: 'jelly' }));
  assert.doesNotThrow(() => controller.stop());
});

test('运行中隐藏会归位并结束，非法工作区不会排入计时器', () => {
  const f = fixture();
  f.controller.start({ token: 1, action: 'hop' });
  f.at(540);
  f.win.visible = false;
  f.at(556);
  assert.deepEqual(f.bounds, f.origin);
  assert.equal(f.frames.at(-1).frame.done, true);
  assert.equal(f.timers.size, 0);
  f.win.visible = true;
  f.workArea.width = 10;
  assert.equal(f.controller.start({ token: 2, action: 'bow' }), false);
  assert.equal(f.timers.size, 0);
});
