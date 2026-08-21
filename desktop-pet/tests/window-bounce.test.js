const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BOUNCE_TOTAL_MS,
  bounceOffset
} = require('../lib/window-bounce');

test('桌宠窗口按原动画的四段高度跳跃', () => {
  assert.equal(bounceOffset(0, 259), 0);
  assert.equal(bounceOffset(250, 259), 48);
  assert.equal(bounceOffset(500, 259), 0);
  assert.equal(bounceOffset(691, 259), 28);
  assert.equal(bounceOffset(882, 259), 0);
});

test('跳跃高度会随桌宠尺寸缩放并在结束后归零', () => {
  assert.equal(bounceOffset(250, 120), 22);
  assert.equal(bounceOffset(BOUNCE_TOTAL_MS, 259), 0);
  assert.equal(bounceOffset(BOUNCE_TOTAL_MS + 100, 259), 0);
});
