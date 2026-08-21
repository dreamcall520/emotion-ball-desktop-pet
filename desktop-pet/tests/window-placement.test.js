const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SIZES,
  defaultBounds,
  ensureVisibleBounds
} = require('../lib/window-placement');

const primary = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } };

test('默认位置在主屏右下角并保留 24px', () => {
  assert.deepEqual(defaultBounds(primary, 'medium'), {
    x: 1236,
    y: 696,
    width: 180,
    height: 180
  });
});

test('极小尺寸为 80 × 80 并保留右下角安全距离', () => {
  assert.deepEqual(SIZES.tiny, { width: 80, height: 80 });
  assert.deepEqual(defaultBounds(primary, 'tiny'), {
    x: 1336,
    y: 796,
    width: 80,
    height: 80
  });
});

test('屏幕外位置被收敛回可见区域', () => {
  assert.deepEqual(
    ensureVisibleBounds({ x: 2000, y: 1200, ...SIZES.small }, [primary], primary),
    { x: 1296, y: 756, width: 120, height: 120 }
  );
});

test('第二块屏幕上的位置保留在该屏幕内', () => {
  const second = { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } };
  assert.deepEqual(
    ensureVisibleBounds({ x: 3200, y: 1000, ...SIZES.medium }, [primary, second], primary),
    { x: 3180, y: 900, width: 180, height: 180 }
  );
});
