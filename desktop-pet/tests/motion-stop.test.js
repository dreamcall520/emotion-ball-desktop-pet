const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('休息时真正停止自旋和弹跳，而非仅改变表情', () => {
  const context = vm.createContext({
    window: { EmotionBall: { createBall: () => ({ applyPose() {}, destroy() {} }) } },
    console, performance
  });
  for (const file of ['rings.js', 'emotions.js', 'engine.js']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../emotion-ball/js', file), 'utf8'), context);
  }
  const engine = context.window.EmotionBall.create({}, { emotion: '02', idle: false, autostart: false });
  engine.spin(1).bounce();
  assert.ok(engine._spin);
  assert.ok(engine._bounceAt >= 0);
  assert.equal(engine.stopMotion(), engine);
  assert.equal(engine._spin, null);
  assert.equal(engine._bounceAt, -1);
  engine._tick(performance.now() + 100);
  assert.equal(engine._lastPose.body.yaw, 0);
});

test('眼神统一通过同屏状态更新，不被局部鼠标幅度覆盖', () => {
  const renderer = fs.readFileSync(path.resolve(__dirname, '../renderer.js'), 'utf8');
  assert.equal((renderer.match(/ball\.setGaze\(/g) || []).length, 1);
});
