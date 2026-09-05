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
  const display = { id: 1 };
  const win = {
    destroyed: false, visible: true,
    isDestroyed() { return this.destroyed; },
    isVisible() { return this.visible; },
    getBounds: () => ({ ...bounds }),
    setPosition(x, y, animate) { moves.push({ x, y, animate }); bounds.x = x; bounds.y = y; }
  };
  const controller = createWindowMotion({
    getWindow: () => win, getWorkArea: () => workArea, getDisplayId: () => display.id, now: () => now,
    schedule(callback, delay) { callbacks.push(callback); timers.set(++serial, { callback, at: now + delay }); return serial; },
    cancel(id) { timers.delete(id); },
    sendFrame(packet) { frames.push(packet); }
  });
  return { controller, win, frames, moves, callbacks, timers, bounds, origin, workArea, display,
    at(time) { now = time; const queued = [...timers.values()]; timers.clear(); queued.forEach(item => item.callback()); }
  };
}

test('窗口和身体使用同一帧时间，结束回到原位且释放计时器', () => {
  const f = fixture();
  assert.equal(f.controller.start({ token: 1, action: 'hop' }), true);
  f.at(540);
  assert.deepEqual(f.frames.at(-1), { token: 1, action: 'hop', side: 'right', frame: sampleMotion('hop', 540) });
  assert.deepEqual(f.moves.at(-1), { ...positionForMotion(f.origin, f.workArea, sampleMotion('hop', 540).window), animate: false });
  f.at(getMotion('hop').durationMs);
  assert.deepEqual(f.bounds, f.origin);
  assert.equal(f.frames.at(-1).frame.done, true);
  assert.equal(f.timers.size, 0);
});

test('同屏工作区微变保留动作token、原始锚点及起始时间，不新增计时器', () => {
  const f = fixture();
  f.controller.start({ token: 1, action: 'bow' });
  f.at(844);
  const pending = [...f.timers.keys()];
  assert.equal(typeof f.controller.refreshWorkArea, 'function');
  f.workArea.height += 1;
  assert.equal(f.controller.refreshWorkArea(), true);
  assert.deepEqual([...f.timers.keys()], pending);
  assert.equal(f.frames.some(packet => packet.frame.done), false);
  f.at(1000);
  assert.deepEqual(f.frames.at(-1), { token: 1, action: 'bow', side: 'right', frame: sampleMotion('bow', 1000) });
  f.at(1600);
  assert.equal(f.frames.at(-1).frame.done, true);
  assert.deepEqual(f.bounds, f.origin);
});

test('更新工作区立即夹紧当前半空位置，后续轨迹也使用新区而非旧区', () => {
  const f = fixture();
  f.controller.start({ token: 1, action: 'hop' });
  f.at(540);
  assert.ok(f.bounds.y < 35);
  assert.equal(typeof f.controller.refreshWorkArea, 'function');
  f.workArea.y = 35;
  f.workArea.height = 565;
  assert.equal(f.controller.refreshWorkArea(), true);
  assert.equal(f.bounds.y, 35);
  assert.equal(f.frames.at(-1).frame.done, false);
  for (let at = 556; at < 1800; at += 16) {
    f.at(at);
    assert.ok(f.bounds.y >= 35);
    assert.deepEqual(f.frames.at(-1).frame, sampleMotion('hop', at));
  }
  f.at(1800);
  assert.deepEqual(f.bounds, f.origin);
  assert.equal(f.timers.size, 0);
});

test('原始锚点越界、显示器身份改变或区域无效时拒绝继续，交还宿主恢复', () => {
  const f = fixture({ x: -700, y: 520, width: 80, height: 80 });
  f.controller.start({ token: 1, action: 'hop' });
  f.at(540);
  assert.equal(typeof f.controller.refreshWorkArea, 'function');
  f.workArea.height = 599;
  assert.ok(f.bounds.y + f.bounds.height <= 599, '当前半空位置仍在屏内');
  assert.equal(f.controller.refreshWorkArea(), false, '必须检查原始归位锚点');
  f.workArea.height = 600;
  f.display.id = 2;
  assert.equal(f.controller.refreshWorkArea(), false);
  f.display.id = 1;
  f.workArea.height = NaN;
  assert.equal(f.controller.refreshWorkArea(), false);
  f.controller.stop();
  assert.equal(f.controller.refreshWorkArea(), false);
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

test('新动作使用统一窗口轨迹，方向在启动时固定，完成和打断恢复原位', () => {
  const companion = require('../lib/companion-motion');
  const f = fixture();
  const request = { token: 1, action: 'nuzzle', side: 'left' };
  assert.equal(f.controller.start(request), true);
  request.side = 'right';
  f.at(1150);
  assert.deepEqual(f.frames.at(-1), { token: 1, action: 'nuzzle', side: 'left', frame: companion.sample('nuzzle', 1150, 'left') });
  assert.ok(f.bounds.x < f.origin.x);
  f.at(3200);
  assert.deepEqual(f.bounds, f.origin);
  assert.equal(f.frames.at(-1).frame.emotionId, '50');
  assert.equal(f.timers.size, 0);
  f.controller.start({ token: 2, action: 'stretch', side: 'left' });
  f.at(3480);
  assert.ok(f.bounds.y < f.origin.y, '唤醒一圈真实移动窗口');
  f.at(3743);
  assert.ok(f.bounds.x > f.origin.x);
  f.controller.stop();
  assert.deepEqual(f.bounds, f.origin);
  assert.equal(f.frames.at(-1).frame.done, true);
  assert.deepEqual(f.frames.at(-1).frame.body, companion.neutralFrame().body);
  assert.equal(f.timers.size, 0);
});

test('放下卡顿限制每帧50ms，慢帧不会跳变甩彩带，累计足够才完成', () => {
  const companion = require('../lib/companion-motion');
  const f = fixture();
  assert.equal(f.controller.start({ token: 1, action: 'land', side: 'left' }), true);
  f.at(800);
  assert.deepEqual(f.frames.at(-1).frame, companion.sample('land', 50, 'left'));
  f.at(816);
  assert.deepEqual(f.frames.at(-1).frame, companion.sample('land', 66, 'left'));
  f.at(10000);
  assert.deepEqual(f.frames.at(-1).frame, companion.sample('land', 116, 'left'));
  assert.equal(f.frames.at(-1).frame.done, false);
  for (let t = 10016; t <= 12304; t += 16) f.at(t);
  assert.equal(f.frames.at(-1).frame.done, true);
  assert.deepEqual(f.bounds, f.origin);
  assert.equal(f.timers.size, 0);
});

test('小圆路径在负坐标屏幕边缘限位，停止和过期回调不会继续移动', () => {
  const f = fixture({ x: -800, y: 0, width: 80, height: 80 });
  f.controller.start({ token: 1, action: 'stretch', side: 'right' });
  for (let t = 16; t < 1600; t += 16) {
    f.at(t);
    assert.ok(f.bounds.x >= -800);
    assert.ok(f.bounds.y >= 0);
  }
  const stale = f.callbacks.at(-1);
  f.controller.start({ token: 2, action: 'nuzzle', side: 'left' });
  const count = f.frames.length;
  stale();
  assert.equal(f.frames.length, count);
  f.controller.stop();
  assert.deepEqual(f.bounds, f.origin);
  assert.equal(f.timers.size, 0);
});

test('减少动态时三个新动作保持中性且按正常时长结束，不产生转面或小圆位移', () => {
  const companion = require('../lib/companion-motion');
  for (const motion of companion.MOTIONS) {
    const f = fixture();
    assert.equal(f.controller.start({ token: 1, action: motion.id, side: 'left', reducedMotion: true }), true);
    f.at(1150);
    for (const packet of f.frames) {
      assert.deepEqual(packet.frame.body, companion.neutralFrame().body);
      assert.deepEqual(packet.frame.gaze, { x: 0, y: 0 });
      assert.deepEqual(packet.frame.window, { x: 0, y: 0 });
      assert.equal(packet.frame.emotionId, '50');
      assert.equal(packet.frame.done, false);
    }
    assert.deepEqual(f.bounds, f.origin);
    assert.ok(f.moves.every(move => move.x === f.origin.x && move.y === f.origin.y));
    f.at(motion.durationMs);
    assert.equal(f.frames.at(-1).frame.done, true, '放下也使用正常时长而非卡顿累计');
    assert.equal(f.timers.size, 0);
  }
});
