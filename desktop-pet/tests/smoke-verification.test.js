const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chooseMotion } = require('../lib/interaction-motion');
const helperPath = path.resolve(__dirname, '../scripts/verify-body-motion.js');

function helper() {
  assert.ok(fs.existsSync(helperPath), '缺少真实身体动作验收助手');
  return require(helperPath);
}

test('动作验收用轮廓点与实际变换判断边界，不误用旋转矩形的四角', () => {
  const { contourBounds } = helper();
  const points = 'M 0 -1 L 1 0 L 0 1 L -1 0 Z';
  const angle = Math.PI / 4;
  const bounds = contourBounds(points, { a: Math.cos(angle), b: Math.sin(angle), c: -Math.sin(angle), d: Math.cos(angle), e: 1, f: 1 });
  assert.ok(bounds.minX > 0.29 && bounds.maxX < 1.71);
  assert.ok(bounds.minY > 0.29 && bounds.maxY < 1.71);
  assert.equal(bounds.pointCount, 4);
  assert.throws(() => contourBounds('', { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), /轮廓/);
});

test('真实帧边界检查拒绝裁切和改色，但接受负坐标显示器', () => {
  const { assertVisibleFrame } = helper();
  const frame = { viewport: { width: 80, height: 80 }, contour: { minX: 2, maxX: 78, minY: 2, maxY: 78, pointCount: 96 }, bodyColor: '#EEEBE4', eyeColors: ['#1A1A1A', '#1A1A1A'] };
  const area = { x: -1440, y: -200, width: 1440, height: 900 };
  const bounds = { x: -1400, y: -180, width: 80, height: 80 };
  assert.doesNotThrow(() => assertVisibleFrame(frame, bounds, area, 'hop'));
  assert.throws(() => assertVisibleFrame({ ...frame, contour: { ...frame.contour, minX: -1 } }, bounds, area, 'hop'), /裁切/);
  assert.throws(() => assertVisibleFrame({ ...frame, bodyColor: '#FFFFFF' }, bounds, area, 'hop'), /颜色/);
  assert.throws(() => assertVisibleFrame(frame, { ...bounds, x: -1450 }, area, 'hop'), /屏幕/);
});

test('每种动作的真实双击随机值遵守权重与上次动作排除规则', () => {
  const { randomForMotion } = helper();
  const ids = ['hop', 'jelly', 'sway', 'peek', 'bow', 'spin'];
  for (const previous of [null, ...ids]) {
    for (const id of ids.filter(id => id !== previous)) {
      assert.equal(chooseMotion(randomForMotion(id, previous), previous).id, id);
    }
  }
  assert.throws(() => randomForMotion('hop', 'hop'), /排除/);
});

test('结束身体允许原有轻微呼吸，但不允许残留压扁、旋转或位移', () => {
  const { isRestingTransform } = helper();
  assert.equal(typeof isRestingTransform, 'function', '缺少呼吸与动作残留的分离检查');
  const pose = (x, y, rotate, sx, sy) => `translate(${114.27 + x} ${114.27 + y}) rotate(${rotate}) scale(${sx} ${sy}) translate(-114.27 -114.27)`;
  assert.ok(isRestingTransform(pose(0, 0.6, 0, 1.01, 1.01)));
  assert.ok(!isRestingTransform(pose(0, 0, 0, 1, 0.9)));
  assert.ok(!isRestingTransform(pose(0, 0, 2, 1, 1)));
  assert.ok(!isRestingTransform(pose(0, 3, 0, 1, 1)));
  assert.ok(!isRestingTransform(''));
});
