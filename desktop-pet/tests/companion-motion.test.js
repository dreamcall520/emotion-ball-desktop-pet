const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Motion = require('../lib/companion-motion');
const neutral = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, yaw: 0 };
const zero = { x: 0, y: 0 };

test('三个确认动作时长不混用；异常时间安全返回起点，结束和取消帧完全中性', () => {
  assert.deepEqual(Motion.durations, { nuzzle: 3200, land: 2400, stretch: 2000 });
  assert.equal(Motion.sample('__proto__', 20), null);
  assert.equal(Motion.sample('missing', 20), null);
  for (const motion of Motion.MOTIONS) {
    for (const side of ['left', 'right']) {
      const start = Motion.sample(motion.id, 0, side);
      for (const invalid of [-3, NaN, Infinity, '20', undefined]) {
        assert.deepEqual(Motion.sample(motion.id, invalid, side), start);
      }
      for (const elapsed of [motion.durationMs, motion.durationMs + 500]) {
        const frame = Motion.sample(motion.id, elapsed, side);
        assert.deepEqual(frame.body, neutral);
        assert.deepEqual(frame.gaze, zero);
        assert.deepEqual(frame.window, zero);
        assert.equal(frame.done, true);
        assert.equal(frame.emotionId, '50');
      }
    }
  }
  const cancelled = Motion.neutralFrame();
  assert.deepEqual(cancelled.body, neutral);
  assert.deepEqual(cancelled.window, zero);
  assert.deepEqual(cancelled.gaze, zero);
  cancelled.body.x = 20;
  assert.equal(Motion.neutralFrame().body.x, 0);
});

test('摸头侧躺、放下转面分别向内镜像，唤醒保持正脸完成小圆路径', () => {
  for (const id of ['nuzzle', 'land']) {
    for (let t = 0; t < Motion.durations[id]; t += 16) {
      const left = Motion.sample(id, t, 'left');
      const right = Motion.sample(id, t, 'right');
      for (const key of ['x', 'rotate', 'yaw']) assert(Math.abs(left.body[key] + right.body[key]) < 1e-9);
      assert(Math.abs(left.gaze.x + right.gaze.x) < 1e-9);
      assert(Math.abs(left.window.x + right.window.x) < 1e-9);
      assert.equal(left.window.y, right.window.y);
      assert.equal(left.eyesOpen, right.eyesOpen);
    }
  }
  const cuddle = Motion.sample('nuzzle', 1400, 'left');
  assert.equal(cuddle.body.rotate, -65);
  assert.equal(cuddle.window.x, -18);
  assert.equal(cuddle.eyesOpen, 0.07);
  const land = Motion.sample('land', 900, 'left');
  assert.equal(land.body.yaw, -1);
  assert.equal(land.body.rotate, 0);
  assert.deepEqual(land.window, zero);
  const top = Motion.sample('stretch', 280);
  const right = Motion.sample('stretch', 542.5);
  const bottom = Motion.sample('stretch', 805);
  const left = Motion.sample('stretch', 1067.5);
  assert(Math.abs(top.window.y + 11) < 1e-9);
  assert(Math.abs(right.window.x - 11) < 1e-9);
  assert(Math.abs(bottom.window.y - 11) < 1e-9);
  assert(Math.abs(left.window.x + 11) < 1e-9);
  for (const t of [0, 160, 280, 542.5, 805, 1067.5, 1330, 1450, 2000]) {
    const frame = Motion.sample('stretch', t, 'left');
    assert.deepEqual(frame.body, neutral, '唤醒不再侧躺、伸长、旋转或点头');
    assert.deepEqual(frame, Motion.sample('stretch', t, 'right'));
    assert(Math.hypot(frame.window.x, frame.window.y) <= 11 + 1e-9);
  }
});

test('运动全程轮廓不裁切，放下 yaw 的平滑速度低于原生甩彩带门槛', () => {
  for (const motion of Motion.MOTIONS) {
    for (const side of ['left', 'right']) {
      let previous = Motion.sample(motion.id, 0, side);
      for (let t = 1; t <= motion.durationMs; t += 1) {
        const frame = Motion.sample(motion.id, t, side);
        for (const value of [...Object.values(frame.body), ...Object.values(frame.window), ...Object.values(frame.gaze)]) assert(Number.isFinite(value));
        const a = frame.body.rotate * Math.PI / 180;
        const rx = 114.3 * Math.hypot(frame.body.scaleX * Math.cos(a), frame.body.scaleY * Math.sin(a));
        const ry = 114.3 * Math.hypot(frame.body.scaleX * Math.sin(a), frame.body.scaleY * Math.cos(a));
        assert(114.2705 + frame.body.x - rx >= -7 - 1e-9);
        assert(114.2705 + frame.body.x + rx <= 236 + 1e-9);
        assert(114.2705 + frame.body.y - ry >= -7 - 1e-9);
        assert(114.2705 + frame.body.y + ry <= 236 + 1e-9);
        assert(Math.abs(frame.body.yaw - previous.body.yaw) * 1000 < 2);
        previous = frame;
      }
    }
  }
  assert.equal(Motion.getMotion('land').maxFrameMs, 50);
});

function realConfig() {
  const context = vm.createContext({ console });
  context.window = context;
  for (const file of ['rings.js', 'emotions.js', 'engine.js']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../emotion-ball/js', file), 'utf8'), context);
  }
  const config = context.EmotionBall.config;
  assert.equal(config.register({ ...config.get('02').raw, id: '50', name: '安静陪伴', group: 'custom', antics: false, anims: [] }).ok, true);
  return config;
}

test('真实引擎接受原生眼环和双眼序列，无粒子副作用且不覆盖实例主题色', () => {
  const config = realConfig();
  assert.deepEqual(Motion.registerEmotions(config), ['52', '54', '53']);
  assert.deepEqual(Motion.registerEmotions(config), ['52', '54', '53']);
  const sources = { nuzzle: '10', land: '03', stretch: '02' };
  for (const motion of Motion.MOTIONS) {
    const raw = config.get(motion.emotion).raw;
    assert.equal(raw.pool[0], config.get(sources[motion.id]).raw.pool[0]);
    assert.equal(raw.gaze, false);
    assert.equal(raw.antics, false);
    assert.equal(raw.anims.length, 0);
    for (const key of ['breathe', 'ribbons', 'confetti', 'zzz', 'orbit']) assert.equal(raw.body[key], 0);
    assert.equal(Object.hasOwn(raw, 'color'), false);
    assert.equal(Object.hasOwn(raw, 'eyeColor'), false);
    for (const frame of raw.sequence.frames) assert(Math.abs(Motion.sample(motion.id, frame.at).eyesOpen - frame.eyes.both.open) < 1e-9);
    assert.equal(raw.sequence.settle, 'hold');
  }
});

test('注册先检查占用和缺失源，避免覆盖已有表情', () => {
  const config = realConfig();
  assert.throws(() => Motion.registerEmotions(null), /50/);
  assert.equal(config.register({ ...config.get('02').raw, id: '53', name: '其他表情' }).ok, true);
  assert.throws(() => Motion.registerEmotions(config), /53.*占用/);
  assert.equal(config.get('52'), null);
  assert.equal(config.get('54'), null);
});

test('浏览器和 Node 暴露相同纯采样 API，不创建定时器', () => {
  const context = vm.createContext({});
  context.window = context;
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../lib/companion-motion.js'), 'utf8'), context);
  assert.equal(typeof context.CompanionMotion.sample, 'function');
  assert.equal(typeof context.CompanionMotion.registerEmotions, 'function');
  assert.equal(JSON.stringify(context.CompanionMotion.sample('nuzzle', 1150, 'left')), JSON.stringify(Motion.sample('nuzzle', 1150, 'left')));
});
