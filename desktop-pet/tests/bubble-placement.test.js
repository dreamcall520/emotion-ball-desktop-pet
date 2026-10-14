const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bubbleBounds } = require('../lib/bubble-placement');
const { layoutShortcuts } = require('../lib/shortcut-layout');
const { petVisualBounds } = require('../lib/pet-visual-bounds');

const workArea = { x: 0, y: 0, width: 1440, height: 900 };

test('气泡定位规则模块存在', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '../lib/bubble-placement.js')), true);
});

test('普通气泡固定大小并优先位于头顶八像素', () => {
  assert.deepEqual(bubbleBounds({ x: 600, y: 400, width: 80, height: 80 }, workArea), {
    x: 528, y: 306, width: 224, height: 86, placement: 'above', anchorX: 112
  });
});

test('互动气泡加高并保留固定宽度', () => {
  assert.deepEqual(bubbleBounds({ x: 600, y: 400, width: 80, height: 80 }, workArea, true), {
    x: 528, y: 274, width: 224, height: 118, placement: 'above', anchorX: 112
  });
});

test('长文案测量高度会增高气泡并保持头顶间距', () => {
  assert.deepEqual(bubbleBounds({ x: 600, y: 400, width: 80, height: 80 }, workArea, true, 146), {
    x: 528, y: 246, width: 224, height: 146, placement: 'above', anchorX: 112
  });
});

test('顶部不够时自动放到宠物下方', () => {
  assert.deepEqual(bubbleBounds({ x: 600, y: 30, width: 80, height: 80 }, workArea), {
    x: 528, y: 118, width: 224, height: 86, placement: 'below', anchorX: 112
  });
});

test('80 像素宠物不缩小气泡', () => {
  const tiny = bubbleBounds({ x: 500, y: 400, width: 80, height: 80 }, workArea);
  const large = bubbleBounds({ x: 500, y: 400, width: 240, height: 240 }, workArea);
  assert.equal(tiny.width, large.width);
  assert.equal(tiny.height, large.height);
  assert.equal(tiny.width, 224);
});

test('正负坐标屏幕四角均保持八像素留白且箭头在气泡内', () => {
  for (const area of [workArea, { x: -1920, y: -200, width: 1920, height: 1080 }]) {
    for (const x of [area.x, area.x + area.width - 80]) {
      for (const y of [area.y, area.y + area.height - 80]) {
        for (const interactive of [false, true]) {
          const result = bubbleBounds({ x, y, width: 80, height: 80 }, area, interactive);
          assert.ok(result.x >= area.x + 8);
          assert.ok(result.y >= area.y + 8);
          assert.ok(result.x + result.width <= area.x + area.width - 8);
          assert.ok(result.y + result.height <= area.y + area.height - 8);
          assert.ok(result.anchorX >= 35 && result.anchorX <= result.width - 35);
        }
      }
    }
  }
});

test('靠边箭头指向宠物中心并限于安全范围', () => {
  const left = bubbleBounds({ x: 0, y: 400, width: 80, height: 80 }, workArea);
  assert.equal(left.x, 8);
  assert.equal(left.anchorX, 35);
  const far = bubbleBounds({ x: -1000, y: 400, width: 80, height: 80 }, workArea);
  assert.equal(far.anchorX, 35);
});

test('侧移后的箭头留在气泡直边，旋转边框不进入17px圆角', () => {
  for (const area of [workArea, { x: -1920, y: -200, width: 1920, height: 1080 }]) {
    for (const x of [area.x - 1000, area.x + area.width + 1000]) for (const y of [area.y, area.y + 400]) {
      const bubble = bubbleBounds({ x, y, width: 80, height: 80 }, area, true);
      // bubble.css: native inset 10, radius 17, 8px square + 1px border,
      // absolute left anchor-16 places its rotated center at anchor-.5.
      const arrowCenter = bubble.anchorX - .5, half = 9 / Math.SQRT2;
      assert.ok(arrowCenter - half >= 10 + 17 && arrowCenter + half <= bubble.width - 10 - 17,
        '箭头必须完整连接直边，不能叠到圆角上形成突出折角：' + JSON.stringify(bubble));
    }
  }
});

test('极小工作区合理压缩但不越界', () => {
  for (const area of [{ x: -100, y: -80, width: 100, height: 80 }, { x: 0, y: 0, width: 1, height: 1 }]) {
    const result = bubbleBounds({ x: area.x, y: area.y, width: 80, height: 80 }, area, true);
    assert.ok(result.width > 0 && result.height > 0);
    assert.ok(result.x >= area.x && result.y >= area.y);
    assert.ok(result.x + result.width <= area.x + area.width);
    assert.ok(result.y + result.height <= area.y + area.height);
    assert.ok(result.anchorX >= 0 && result.anchorX <= result.width);
  }
});

test('定位不会修改输入对象', () => {
  const pet = Object.freeze({ x: 600, y: 400, width: 80, height: 80 });
  const area = Object.freeze({ ...workArea });
  assert.equal(bubbleBounds(pet, area).placement, 'above');
});

test('非经典外观的气泡贴近实际可见顶部，保留经典外观的视觉间距', () => {
  const pet = { x: 600, y: 400, width: 180, height: 180 };
  const classic = bubbleBounds(pet, workArea);
  const classicGap = pet.y + pet.height * .06 - classic.y - classic.height;
  for (const [shape, visibleTop] of [['cloud', .17], ['aurora-cloud', .105], ['square', .11]]) {
    const bubble = bubbleBounds(pet, workArea, false, null, shape);
    const gap = pet.y + pet.height * visibleTop - bubble.y - bubble.height;
    assert.ok(Math.abs(gap - classicGap) <= 1, `${shape} 的气泡与可见轮廓间距应接近经典`);
  }
});

test('同场气泡避开六张真实快捷卡，四角内缩与负坐标屏幕均不遮挡', () => {
  const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  for (const area of [workArea, { x: -1920, y: -1080, width: 1920, height: 1040 }])
    for (const size of [80, 180, 260]) for (const inset of [0, 40, 80]) for (const px of [0, 1]) for (const py of [0, 1]) {
      const pet = { x: area.x + (px ? area.width - size - inset : inset), y: area.y + (py ? area.height - size - inset : inset), width: size, height: size };
      const shape = 'aurora-cloud', visual = petVisualBounds(pet, shape);
      const layout = layoutShortcuts({ petBounds: visual, workArea: area, shape: 'floating' });
      const obstacles = layout.items.map(item => ({ ...item, x: layout.bounds.x + item.x, y: layout.bounds.y + item.y }));
      const result = bubbleBounds(pet, area, false, null, shape, obstacles);
      assert.ok(obstacles.every(card => !intersects(card, result)), `${size}/${inset}/${px}/${py} bubble leaves every action clear`);
      assert.ok(!intersects(visual, result), 'bubble does not cover the pet');
      assert.ok(result.x >= area.x + 8 && result.y >= area.y + 8 && result.x + result.width <= area.x + area.width - 8 && result.y + result.height <= area.y + area.height - 8);
      assert.ok(result.anchorX >= 35 && result.anchorX <= result.width - 35);
      assert.equal(result.placement, result.y + result.height / 2 < visual.y + visual.height / 2 ? 'above' : 'below');
    }
});

test('快捷卡不挡原位置时气泡布局逐字段保持原样', () => {
  const pet = { x: 600, y: 400, width: 80, height: 80 };
  assert.deepEqual(bubbleBounds(pet, workArea, true, 146, 'blob', [{ x: 0, y: 0, width: 24, height: 24 }]),
    bubbleBounds(pet, workArea, true, 146, 'blob'));
});
