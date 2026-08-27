const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isDrag,
  chooseClickAction
} = require('../lib/pet-behavior');

test('移动超过 6px 才算拖动', () => {
  assert.equal(isDrag({ x: 0, y: 0 }, { x: 4, y: 4 }), false);
  assert.equal(isDrag({ x: 0, y: 0 }, { x: 7, y: 0 }), true);
});

test('单击动作按随机数稳定映射', () => {
  assert.equal(chooseClickAction(0.1), 'bounce');
  assert.equal(chooseClickAction(0.5), 'spin');
  assert.equal(chooseClickAction(0.9), 'happy');
});
