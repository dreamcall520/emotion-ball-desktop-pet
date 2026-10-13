const test = require('node:test');
const assert = require('node:assert/strict');
const { layoutShortcuts } = require('../lib/shortcut-layout');
const { petVisualBounds } = require('../lib/pet-visual-bounds');

const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const distance = (a, b) => Math.hypot(Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width), Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height));
const globalCards = layout => layout.items.map(item => ({ ...item, x: item.x + layout.bounds.x, y: item.y + layout.bounds.y }));
const normalRadius = pet => {
  const card = Math.max(pet.width, pet.height) <= 108 ? 52 : 58;
  return Math.max(card * 2 + 12, Math.ceil((Math.max(pet.width, pet.height) / 2 + card / 2 + 12) / Math.cos(Math.PI / 5)));
};
const checkCompactDistance = (layout, pet) => {
  const cards = globalCards(layout), limit = normalRadius(pet) + layout.cardSize + 6 + 1.5;
  for (const card of cards) {
    assert.ok(Math.hypot(card.x + card.width / 2 - pet.x - pet.width / 2,
      card.y + card.height / 2 - pet.y - pet.height / 2) <= limit, 'corner cards remain within one extra card of the normal radius');
    assert.equal(overlap(card, { x: pet.x - 12, y: pet.y - 12, width: pet.width + 24, height: pet.height + 24 }), false,
      'corner cards retain the normal 12 DIP pet clearance');
  }
};

function checkLayout(layout, pet, area) {
  const bounds = layout.bounds;
  assert.ok(bounds.x >= area.x && bounds.y >= area.y);
  assert.ok(bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height);
  if (layout.shape === 'list') {
    assert.equal(overlap(bounds, pet), false);
    assert.equal(layout.items.length, 5);
    assert.ok(bounds.width <= 320 && bounds.height <= 326, 'list stays within the compact window size');
    assert.ok(layout.items.every(item => item.height === 44), 'list retains readable 44 DIP rows');
    return;
  }
  assert.equal(layout.items.length, 6);
  assert.ok(pet.x >= bounds.x && pet.y >= bounds.y && pet.x + pet.width <= bounds.x + bounds.width && pet.y + pet.height <= bounds.y + bounds.height, 'native canvas includes the expansion path to the pet');
  assert.ok(layout.cardSize >= 52);
  const cards = globalCards(layout);
  for (const [index, card] of cards.entries()) {
    assert.equal(overlap(card, pet), false, `card ${index} avoids pet`);
    assert.ok(card.x >= area.x + 12 && card.y >= area.y + 12);
    assert.ok(card.x + card.width <= area.x + area.width - 12 && card.y + card.height <= area.y + area.height - 12);
    for (const other of cards.slice(index + 1)) assert.ok(distance(card, other) >= 6, 'cards retain at least 6 DIP clearance');
  }
}

test('六种原生球尺寸在四边、四角、负坐标屏幕和小工作区均有有界布局', () => {
  const areas = [{ x: 0, y: 24, width: 1440, height: 876 }, { x: -1920, y: -1080, width: 1920, height: 1040 },
    { x: 1440, y: 40, width: 1280, height: 760 }, { x: -640, y: 0, width: 640, height: 480 }];
  for (const area of areas) for (const size of [60, 80, 108, 120, 180, 260]) {
    for (const px of [0, 0.5, 1]) for (const py of [0, 0.5, 1]) {
      const pet = { x: area.x + Math.round((area.width - size) * px), y: area.y + Math.round((area.height - size) * py), width: size, height: size };
      for (const shape of ['floating', 'list']) {
        const layout = layoutShortcuts({ petBounds: pet, workArea: area, shape, side: px === 0 ? 'left' : px === 1 ? 'right' : undefined });
        checkLayout(layout, pet, area);
      }
    }
  }
});

test('上下沿朝屏内展开，左右贴边朝相反侧展开，卡片始终保持正方形', () => {
  const area = { x: -1440, y: -100, width: 1440, height: 900 };
  for (const size of [60, 80, 108, 120, 180, 260]) {
    const cases = [
      [{ x: area.x + (area.width - size) / 2, y: area.y, width: size, height: size }, undefined, 'below'],
      [{ x: area.x + (area.width - size) / 2, y: area.y + area.height - size, width: size, height: size }, undefined, 'above'],
      [{ x: area.x, y: area.y + (area.height - size) / 2, width: size, height: size }, 'left', 'right'],
      [{ x: area.x + area.width - size, y: area.y + (area.height - size) / 2, width: size, height: size }, 'right', 'left']
    ];
    for (const [pet, side, direction] of cases) {
      const layout = layoutShortcuts({ petBounds: pet, workArea: area, side });
      assert.equal(layout.shape, 'floating');
      assert.equal(layout.direction, direction);
      assert.ok(layout.items.every(item => item.width === item.height && item.width === layout.cardSize));
      checkLayout(layout, pet, area);
    }
  }
});

test('桌角六卡保持正常球边距，最多增加一张卡宽而不放大整圈', () => {
  const areas = [{ x: 0, y: 24, width: 1440, height: 876 },
    { x: -1920, y: -1080, width: 1920, height: 1040 }];
  for (const area of areas) for (const size of [60, 80, 108, 120, 180, 260]) {
    for (const sx of [1, -1]) for (const sy of [1, -1]) for (const inset of [0, 24, 60, 80, 100]) {
      const pet = { x: sx === 1 ? area.x + inset : area.x + area.width - size - inset,
        y: sy === 1 ? area.y + inset : area.y + area.height - size - inset, width: size, height: size };
      const layout = layoutShortcuts({ petBounds: pet, workArea: area, side: sx === 1 ? 'left' : 'right' });
      assert.equal(layout.shape, 'floating');
      checkLayout(layout, pet, area);
      checkCompactDistance(layout, pet);
      assert.deepEqual(layout.items.map(card => card.id), ['chat', 'custom', 'note', 'todo', 'pomodoro', 'settings']);
    }
  }
});

test('离开桌角阈值时已恢复普通半圆，阈值两侧不会突变或交换入口顺序', () => {
  const area = { x: -1920, y: -1080, width: 1920, height: 1040 };
  for (const size of [60, 80, 108, 120, 180, 260]) {
    const card = size <= 108 ? 52 : 58;
    const radius = Math.max(card * 2 + 12, Math.ceil((size / 2 + card / 2 + 12) / Math.cos(Math.PI / 5)));
    const reach = radius + card / 2 - size / 2 + 12;
    for (const sx of [1, -1]) for (const sy of [1, -1]) for (const horizontal of [false, true]) {
      const layouts = Array.from({ length: 7 }, (_, offset) => {
        const inset = Math.ceil(reach + card) - 3 + offset;
        const ix = horizontal ? inset : 0, iy = horizontal ? 0 : inset;
        const pet = { x: sx === 1 ? area.x + ix : area.x + area.width - size - ix,
          y: sy === 1 ? area.y + iy : area.y + area.height - size - iy, width: size, height: size };
        const side = horizontal ? sy === 1 ? 'top' : 'bottom' : sx === 1 ? 'left' : 'right';
        const layout = layoutShortcuts({ petBounds: pet, workArea: area, side });
        assert.equal(layout.shape, 'floating');
        checkLayout(layout, pet, area);
        return globalCards(layout);
      });
      for (let index = 1; index < layouts.length; index++) for (let card = 0; card < 6; card++) {
        assert.equal(layouts[index][card].id, layouts[index - 1][card].id);
        assert.ok(Math.hypot(layouts[index][card].x - layouts[index - 1][card].x,
          layouts[index][card].y - layouts[index - 1][card].y) <= 10, 'one DIP crossing does not move a card to the opposite arc');
      }
    }
  }
});

test('60..260每个整数尺寸在四角及近角保持紧凑完整六卡或安全列表兜底', () => {
  const areas = [{ x: -1920, y: -1080, width: 1920, height: 1040 },
    { x: -640, y: 24, width: 640, height: 480 }];
  for (const area of areas) for (let size = 60; size <= 260; size++) {
    for (const sx of [1, -1]) for (const sy of [1, -1]) for (const inset of [0, 12, 24, 80]) {
      const pet = { x: sx === 1 ? area.x + inset : area.x + area.width - size - inset,
        y: sy === 1 ? area.y + inset : area.y + area.height - size - inset, width: size, height: size };
      const layout = layoutShortcuts({ petBounds: pet, workArea: area, side: sx === 1 ? 'left' : 'right' });
      checkLayout(layout, pet, area);
      if (layout.shape !== 'floating') continue;
      checkCompactDistance(layout, pet);
      assert.ok(layout.items.every(item => item.width === item.height), 'corner cards stay square');
    }
  }
});

test('桌角非正方形轮廓使用实际visual center，支持负坐标显示器', () => {
  const area = { x: -1440, y: -900, width: 1440, height: 900 };
  for (const shape of ['dumpling', 'cloud', 'aurora-cloud', 'egg', 'square', 'wedge', 'gem']) {
    for (const size of [60, 80, 108, 120, 180, 260]) for (const sx of [1, -1]) for (const sy of [1, -1]) {
      const native = { x: sx === 1 ? area.x : area.x + area.width - size,
        y: sy === 1 ? area.y : area.y + area.height - size, width: size, height: size };
      const pet = petVisualBounds(native, shape);
      const layout = layoutShortcuts({ petBounds: pet, workArea: area, side: sx === 1 ? 'left' : 'right' });
      assert.equal(layout.shape, 'floating');
      checkLayout(layout, pet, area);
      checkCompactDistance(layout, pet);
    }
  }
});

test('近角已有正常半圆空间时优先正常间距，80 DIP真角紧凑排布小于旧254 DIP半径', () => {
  const area = { x: 0, y: 0, width: 1440, height: 900 };
  const radii = pet => { const layout = layoutShortcuts({ petBounds: pet, workArea: area, side: 'right' });
    checkLayout(layout, pet, area); return globalCards(layout).map(card => Math.hypot(
      card.x + card.width / 2 - pet.x - pet.width / 2, card.y + card.height / 2 - pet.y - pet.height / 2)); };
  const corner = { x: 1360, y: 820, width: 80, height: 80 };
  assert.ok(Math.max(...radii(corner)) <= 141, 'true corner uses compact staggered cards, not a distant 254 DIP arc');
  for (let inset = 0; inset <= 125; inset++) {
    assert.ok(Math.max(...radii({ ...corner, x: corner.x - inset, y: corner.y - inset })) <= 141,
      'near-corner positions do not retain the old 168..230 DIP distant arc');
  }
  const nearCorner = { ...corner, x: corner.x - 125, y: corner.y - 125 };
  assert.ok(Math.max(...radii(nearCorner)) <= 117, 'available space restores the normal 116 DIP radius');
  const ordinary = { ...corner, x: 680, y: 410 };
  assert.ok(Math.max(...radii(ordinary)) <= 117, 'normal desktop spacing is preserved');
});

test('半圆为等角度180度弧；移动时整组平移，不逐卡裁边', () => {
  const area = { x: 0, y: 0, width: 1440, height: 900 };
  for (const direction of ['left', 'right', 'top', 'bottom']) {
    const pet = { x: 680, y: 410, width: 80, height: 80 };
    const layout = layoutShortcuts({ petBounds: pet, workArea: area, side: direction });
    const horizontal = ['above', 'below'].includes(layout.direction);
    const cards = globalCards(layout);
    const first = cards[0], last = cards[5];
    const center = { x: (first.x + last.x + first.width) / 2, y: (first.y + last.y + first.height) / 2 };
    const radii = cards.map(card => Math.hypot(card.x + card.width / 2 - center.x, card.y + card.height / 2 - center.y));
    assert.ok(Math.max(...radii) - Math.min(...radii) < 1);
    assert.equal(horizontal ? first.y : first.x, horizontal ? last.y : last.x);
    const translated = layoutShortcuts({ petBounds: { ...pet, x: pet.x + 11, y: pet.y + 7 }, workArea: area, side: direction });
    assert.deepEqual(translated.items, layout.items);
    assert.equal(translated.bounds.x, layout.bounds.x + 11);
    assert.equal(translated.bounds.y, layout.bounds.y + 7);
  }
});

test('工作区太小放不下完整弧形时退为可滚动列表，非法坐标被拒绝', () => {
  const area = { x: -640, y: 20, width: 480, height: 360 };
  const pet = { x: -640, y: 20, width: 260, height: 260 };
  const layout = layoutShortcuts({ petBounds: pet, workArea: area, side: 'left' });
  assert.equal(layout.shape, 'list');
  checkLayout(layout, pet, area);
  assert.throws(() => layoutShortcuts({ petBounds: { ...pet, x: NaN }, workArea: area }), TypeError);
  assert.throws(() => layoutShortcuts({ petBounds: pet, workArea: { ...area, width: 0 } }), TypeError);
});


test('普通工作区列表采用320×326紧凑窗，五行坐标与44px行高一致', () => {
  const area = { x: -1440, y: 24, width: 1440, height: 876 };
  const pet = { x: -760, y: 400, width: 80, height: 80 };
  const layout = layoutShortcuts({ petBounds: pet, workArea: area, shape: 'list' });
  checkLayout(layout, pet, area);
  assert.deepEqual({ width: layout.bounds.width, height: layout.bounds.height }, { width: 320, height: 326 });
  assert.deepEqual(layout.items.map(({ x, y, width, height }) => ({ x, y, width, height })),
    Array.from({ length: 5 }, (_, index) => ({ x: 15, y: 55 + index * 45, width: 290, height: 44 })));
});
