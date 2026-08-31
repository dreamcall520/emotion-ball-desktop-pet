const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bubbleBounds } = require('../lib/bubble-placement');

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
          assert.ok(result.anchorX >= 20 && result.anchorX <= result.width - 20);
        }
      }
    }
  }
});

test('靠边箭头指向宠物中心并限于安全范围', () => {
  const left = bubbleBounds({ x: 0, y: 400, width: 80, height: 80 }, workArea);
  assert.equal(left.x, 8);
  assert.equal(left.anchorX, 32);
  const far = bubbleBounds({ x: -1000, y: 400, width: 80, height: 80 }, workArea);
  assert.equal(far.anchorX, 20);
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
