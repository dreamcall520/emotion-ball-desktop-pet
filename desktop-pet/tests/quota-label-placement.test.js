const test = require('node:test');
const assert = require('node:assert/strict');
const { quotaLabelBounds } = require('../lib/quota-label-placement');

const AREA = Object.freeze({ x: 0, y: 0, width: 1440, height: 900 });

function assertFiniteBounds(result) {
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.equal(Number.isFinite(result[key]), true, `${key} 应为有限数字`);
  }
  assert.ok(result.width >= 0);
  assert.ok(result.height >= 0);
}

function assertInside(result, area) {
  assert.ok(result.x >= area.x);
  assert.ok(result.y >= area.y);
  assert.ok(result.x + result.width <= area.x + area.width);
  assert.ok(result.y + result.height <= area.y + area.height);
}

test('标准档使用原小巧版 168×58，优先放在球球下方八像素且不修改输入', () => {
  const pet = Object.freeze({ x: 600, y: 400, width: 80, height: 80 });
  const area = Object.freeze({ ...AREA });
  const obstacle = Object.freeze({ x: 10, y: 10, width: 20, height: 20 });
  assert.deepEqual(quotaLabelBounds(pet, area, obstacle), {
    x: 556, y: 488, width: 168, height: 58, placement: 'below'
  });
});

test('小巧档折叠为 128×32，点击展开为 196×84 完整明细', () => {
  const pet = Object.freeze({ x: 600, y: 400, width: 80, height: 80 });
  const area = Object.freeze({ ...AREA });
  assert.deepEqual(quotaLabelBounds(pet, area, null, 'compact'), {
    x: 576, y: 488, width: 128, height: 32, placement: 'below'
  });
  assert.deepEqual(quotaLabelBounds(pet, area, null, 'compact', true), {
    x: 542, y: 488, width: 196, height: 84, placement: 'below'
  });
  assert.deepEqual(quotaLabelBounds(pet, area, null, 'unknown'), {
    x: 556, y: 488, width: 168, height: 58, placement: 'below'
  });
});

test('下方被气泡占用时按上、右、左的顺序避让', () => {
  const pet = { x: 600, y: 400, width: 80, height: 80 };
  const below = { x: 556, y: 488, width: 168, height: 58 };
  assert.equal(quotaLabelBounds(pet, AREA, below).placement, 'above');

  const topLeftPet = { x: 0, y: 20, width: 80, height: 80 };
  const bubble = { x: 8, y: 108, width: 224, height: 118 };
  assert.deepEqual(quotaLabelBounds(topLeftPet, AREA, bubble), {
    x: 88, y: 31, width: 168, height: 58, placement: 'right'
  });

  const rightPet = { x: 1360, y: 400, width: 80, height: 80 };
  assert.equal(quotaLabelBounds(rightPet, AREA).placement, 'left');
});

test('正负坐标双屏四边均在当前屏内', () => {
  for (const area of [AREA, { x: -1920, y: -180, width: 1920, height: 1080 }]) {
    const pets = [
      { x: area.x, y: area.y, width: 80, height: 80 },
      { x: area.x + area.width - 80, y: area.y, width: 80, height: 80 },
      { x: area.x, y: area.y + area.height - 80, width: 80, height: 80 },
      { x: area.x + area.width - 80, y: area.y + area.height - 80, width: 80, height: 80 }
    ];
    for (const pet of pets) assertInside(quotaLabelBounds(pet, area), area);
  }
});

test('60/80/120/180/260 五档球球均保持 168×58 标准标签和八像素间距', () => {
  for (const size of [60, 80, 120, 180, 260]) {
    const pet = { x: 600, y: 300, width: size, height: size };
    const result = quotaLabelBounds(pet, AREA);
    assert.equal(result.placement, 'below');
    assert.equal(result.width, 168);
    assert.equal(result.height, 58);
    assert.equal(result.y, pet.y + size + 8);
    assert.equal(result.x, Math.round(pet.x + (size - 168) / 2));
  }
});

test('候选位置必须完整在屏内且不与气泡相交', () => {
  const pet = { x: 600, y: 400, width: 80, height: 80 };
  const below = { x: 556, y: 488, width: 168, height: 58 };
  const above = { x: 556, y: 334, width: 168, height: 58 };
  const combinedObstacle = { x: 542, y: 310, width: 146, height: 252 };
  const result = quotaLabelBounds(pet, AREA, combinedObstacle);
  assert.equal(result.placement, 'right');
  assert.equal(result.x, 688);
  assert.equal(result.y, 411);
  assert.ok(!(result.x < combinedObstacle.x + combinedObstacle.width &&
    result.x + result.width > combinedObstacle.x && result.y < combinedObstacle.y + combinedObstacle.height &&
    result.y + result.height > combinedObstacle.y));
  assert.ok(below.y < combinedObstacle.y + combinedObstacle.height);
  assert.ok(above.y + above.height > combinedObstacle.y);
});

test('极小或畸形工作区安全收敛，不产生负尺寸或非有限数', () => {
  for (const area of [
    { x: -40, y: -30, width: 40, height: 30 },
    { x: 10, y: 20, width: 1, height: 1 },
    { x: Number.NaN, y: Infinity, width: -10, height: Number.NaN }
  ]) {
    const result = quotaLabelBounds({ x: -999, y: 999, width: 80, height: 80 }, area);
    assertFiniteBounds(result);
    if (Number.isFinite(area.x) && Number.isFinite(area.y) && area.width > 0 && area.height > 0) {
      assertInside(result, area);
    }
    assert.ok(['below', 'above', 'right', 'left'].includes(result.placement));
  }
});

test('宠物、工作区和障碍物畸形输入均安全降级且不修改对象', () => {
  const pet = Object.freeze({ x: Number.NaN, y: -Infinity, width: -80, height: 'bad' });
  const area = Object.freeze({ x: -100, y: -50, width: 500, height: 300 });
  const obstacle = Object.freeze({ x: Number.NaN, y: 0, width: -1, height: Infinity });
  const result = quotaLabelBounds(pet, area, obstacle);
  assertFiniteBounds(result);
  assertInside(result, area);
  assert.equal(result.width, 168);
  assert.equal(result.height, 58);
});

test('Number.MAX_VALUE 级别的有限坐标与尺寸不得在中间加法中溢出', () => {
  const max = Number.MAX_VALUE;
  for (const [pet, area, obstacle] of [
    [{ x: max, y: max, width: max, height: max }, { x: max, y: max, width: max, height: max }, null],
    [{ x: max, y: max, width: max, height: max }, { x: 0, y: 0, width: 1440, height: 900 }, null],
    [{ x: -max, y: -max, width: 260, height: 260 }, { x: max, y: -max, width: max, height: max }, null],
    [{ x: max, y: -max, width: 80, height: 80 }, { x: -max, y: max, width: max, height: max },
      { x: max, y: max, width: max, height: max }]
  ]) {
    const result = quotaLabelBounds(pet, area, obstacle);
    assertFiniteBounds(result);
    assert.ok(['below', 'above', 'right', 'left'].includes(result.placement));
  }
});
