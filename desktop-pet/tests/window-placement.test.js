const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SIZES,
  defaultBounds,
  ensureVisibleBounds,
  adjacentBounds,
  positionWindowNearPet
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

test('紧凑尺寸为 108 × 108 并保留右下角安全距离', () => {
  assert.deepEqual(SIZES.compact, { width: 108, height: 108 });
  assert.deepEqual(defaultBounds(primary, 'compact'), {
    x: 1308,
    y: 768,
    width: 108,
    height: 108
  });
});

test('超小尺寸为 60 × 60 并保留右下角安全距离', () => {
  assert.deepEqual(SIZES.micro, { width: 60, height: 60 });
  assert.deepEqual(defaultBounds(primary, 'micro'), {
    x: 1356,
    y: 816,
    width: 60,
    height: 60
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

test('功能窗口以球球选屏，覆盖负坐标、屏幕接缝、边角和小工作区', () => {
  const areas = [primary.workArea, { x: 1440, y: 24, width: 1920, height: 1016 },
    { x: -1920, y: -1080, width: 1920, height: 1040 }, { x: 0, y: 0, width: 640, height: 480 }];
  for (const area of areas) for (const horizontal of [0, 0.5, 1]) for (const vertical of [0, 0.5, 1]) {
    const pet = { x: area.x + (area.width - 80) * horizontal, y: area.y + (area.height - 80) * vertical, width: 80, height: 80 };
    let bounds = { x: 8000, y: 8000, width: 960, height: 700 }, minimum = [760, 580];
    const win = { getBounds: () => bounds, getMinimumSize: () => minimum,
      setMinimumSize: (w, h) => { minimum = [w, h]; }, setBounds: value => { bounds = value; } };
    let currentArea = area;
    const screen = { getDisplayMatching: anchor => { assert.equal(anchor, pet); return { workArea: currentArea }; } };
    positionWindowNearPet(win, pet, screen);
    assert.equal(bounds.width, Math.min(960, area.width));
    assert.equal(bounds.height, Math.min(700, area.height));
    assert.ok(bounds.x >= area.x && bounds.y >= area.y);
    assert.ok(bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height);
    assert.deepEqual(minimum, [Math.min(760, area.width), Math.min(580, area.height)]);
    currentArea = primary.workArea;
    positionWindowNearPet(win, pet, screen);
    assert.deepEqual(minimum, [760, 580], '回到大屏后恢复原生最小尺寸');
  }
});


test('功能窗口避开实际可见额度和 API 卡，紧凑/展开高度变化无需固定偏移', () => {
  const area = { x: -1920, y: -300, width: 1920, height: 1080 };
  const pet = { x: -1000, y: -250, width: 80, height: 80 };
  for (const quotaHeight of [32, 58, 144]) {
    const quota = { x: -1058, y: -162, width: 196, height: quotaHeight };
    const api = { x: -1024, y: quota.y + quota.height + 8, width: 128, height: 32 };
    const bounds = adjacentBounds(pet, area, { width: 600, height: 500 }, [quota, api]);
    assert.equal(bounds.y, api.y + api.height + 8, '窗口从最后一张可见卡片下方打开');
    assert.ok(bounds.x >= area.x && bounds.x + bounds.width <= area.x + area.width);
    assert.ok(bounds.y + bounds.height <= area.y + area.height);
  }
  const withoutCards = adjacentBounds(pet, area, { width: 600, height: 500 });
  assert.equal(withoutCards.y, pet.y + pet.height + 8, '卡片隐藏时不预留多余位置');
});

test('可见卡片位于边角或工作区过小时，功能窗口仍限制在球球当前屏', () => {
  const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  for (const area of [primary.workArea, { x: -1920, y: -1080, width: 1920, height: 1040 }, { x: 0, y: 0, width: 300, height: 200 }]) {
    for (const corner of [0, 0.5, 1]) {
      const pet = { x: area.x + (area.width - 80) * corner, y: area.y + (area.height - 80) * corner, width: 80, height: 80 };
      const card = require('../lib/quota-label-placement').quotaLabelBounds(pet, area, null, 'compact');
      const bounds = adjacentBounds(pet, area, { width: 380, height: 520 }, [card]);
      assert.ok(bounds.x >= area.x && bounds.y >= area.y);
      assert.ok(bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height);
      if (area.width >= 1440) { assert.equal(overlap(bounds, card), false); assert.equal(overlap(bounds, pet), false); }
    }
  }
});
