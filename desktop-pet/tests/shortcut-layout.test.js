const test = require('node:test');
const assert = require('node:assert/strict');
const { layoutShortcuts } = require('../lib/shortcut-layout');

const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const distance = (a, b) => Math.hypot(Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width), Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height));
const globalCards = layout => layout.items.map(item => ({ ...item, x: item.x + layout.bounds.x, y: item.y + layout.bounds.y }));

function checkLayout(layout, pet, area) {
  const bounds = layout.bounds;
  assert.ok(bounds.x >= area.x && bounds.y >= area.y);
  assert.ok(bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height);
  if (layout.shape === 'list') {
    assert.equal(overlap(bounds, pet), false);
    assert.equal(layout.items.length, 5);
    return;
  }
  assert.equal(layout.items.length, 6);
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
  const area = { x: -640, y: 20, width: 640, height: 480 };
  const pet = { x: -640, y: 20, width: 260, height: 260 };
  const layout = layoutShortcuts({ petBounds: pet, workArea: area, side: 'left' });
  assert.equal(layout.shape, 'list');
  checkLayout(layout, pet, area);
  assert.throws(() => layoutShortcuts({ petBounds: { ...pet, x: NaN }, workArea: area }), TypeError);
  assert.throws(() => layoutShortcuts({ petBounds: pet, workArea: { ...area, width: 0 } }), TypeError);
});
