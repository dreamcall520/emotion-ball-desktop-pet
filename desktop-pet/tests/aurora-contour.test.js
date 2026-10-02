const test = require('node:test');
const assert = require('node:assert/strict');
const { createShape } = require('../../emotion-ball/js/custom-shapes');
const { auroraTurnRing } = require('../lib/customization');

test('幻彩具有六个圆鼓外瓣，旧配置归一为同一轮廓', () => {
  const original = createShape({ shape: 'aurora-cloud' });
  assert.deepEqual(createShape({ shape: 'aurora-cloud', auroraContour: 'original' }), original);
  const six = createShape({ shape: 'aurora-cloud', auroraContour: 'six-lobe' });
  assert.deepEqual(six.face, original.face, '沿用眼睛参数');
  assert.equal(six.ring.length, 96);
  const radii = six.ring.map(([x, y]) => Math.hypot((x - 114.2705) / 108, (y - 114.2705) / 107));
  const peaks = radii.filter((r, i) => r > radii[(i + 95) % 96] && r > radii[(i + 1) % 96]);
  assert.equal(peaks.length, 6);
  assert.deepEqual(six.ring, original.ring);
  assert.deepEqual(auroraTurnRing(six.ring, 0), six.ring, '互动结束可复原新轮廓');
});

test('幻彩云转身中间态从已确认轮廓连续变成圆角四边形，再精确复原', () => {
  const approved = createShape({ shape: 'aurora-cloud' }).ring;
  const start = auroraTurnRing(approved, 0);
  const midway = auroraTurnRing(approved, 0.5);
  const rounded = auroraTurnRing(approved, 1);
  assert.deepEqual(start, approved);
  assert.notStrictEqual(start, approved);
  assert.equal(midway.length, approved.length);
  assert.equal(rounded.length, approved.length);
  for (let index = 0; index < approved.length; index++) {
    const original = approved[index];
    const halfway = midway[index];
    const target = rounded[index];
    assert.ok(target.every(Number.isFinite));
    assert.ok(Math.hypot(target[0] - original[0], target[1] - original[1]) < 35,
      '转身圆角阶段仍与六瓣轮廓对齐');
    assert.ok(Math.abs(halfway[0] - (original[0] + target[0]) / 2) < 1e-6);
    assert.ok(Math.abs(halfway[1] - (original[1] + target[1]) / 2) < 1e-6);
  }
  const widestX = Math.max(...rounded.map(point => point[0]));
  const narrowestX = Math.min(...rounded.map(point => point[0]));
  const highestY = Math.min(...rounded.map(point => point[1]));
  const lowestY = Math.max(...rounded.map(point => point[1]));
  assert.ok(widestX - narrowestX > 195 && widestX - narrowestX < 220);
  assert.ok(lowestY - highestY > 175 && lowestY - highestY < 215);
  const angle = (prev, current, next) => {
    const incoming = [current[0] - prev[0], current[1] - prev[1]];
    const outgoing = [next[0] - current[0], next[1] - current[1]];
    return Math.acos(Math.max(-1, Math.min(1,
      (incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) /
      (Math.hypot(...incoming) * Math.hypot(...outgoing))))) * 180 / Math.PI;
  };
  assert.ok(rounded.every((point, index) =>
    angle(rounded[(index + 95) % 96], point, rounded[(index + 1) % 96]) < 12),
  '四角与连接处连续，没有尖折');
  assert.deepEqual(auroraTurnRing(approved, 0), approved, '结束后恢复静态已确认图形');
});

test('幻彩云转身轮廓忽略非法输入，避免损坏 SVG', () => {
  assert.equal(auroraTurnRing([[0, 0]], 1), null);
  const approved = createShape({ shape: 'aurora-cloud' }).ring;
  assert.deepEqual(auroraTurnRing(approved, NaN), approved);
  assert.deepEqual(auroraTurnRing(approved, -1), approved);
  assert.deepEqual(auroraTurnRing(approved, 2), auroraTurnRing(approved, 1));
  assert.equal(auroraTurnRing(Array.from({ length: 96 }, () => [5, 5]), 1), null);
  const tuned = createShape({ shape: 'aurora-cloud',
    shapeTuning: { width: 1.2, height: 0.85, softness: 0.5, asymmetry: 0 } }).ring;
  assert.ok(auroraTurnRing(tuned, 1).every(point => point.every(Number.isFinite)));
});
