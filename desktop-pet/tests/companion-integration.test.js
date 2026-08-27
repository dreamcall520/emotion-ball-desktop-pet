const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

test('隔离桥只传活动状态与场景名，不开放任意系统访问', () => {
  const source = read('preload.js');
  for (const name of ['onActivity', 'onSettings', 'say']) {
    assert.match(source, new RegExp(`${name}:`));
  }
  assert.doesNotMatch(source, /exposeInMainWorld\([^,]+,\s*(?:ipcRenderer|require)/);
});

test('桌宠停用局部空闲计时，以系统活动控制状态', () => {
  const source = read('renderer.js');
  assert.match(source, /idle:\s*false/);
  assert.match(source, /CompanionState/);
  assert.match(source, /PettingTracker/);
  assert.match(source, /onActivity/);
});

test('气泡具有独立的非激活窗口，不缩放宠物窗口', () => {
  const file = path.resolve(__dirname, '../lib/bubble-window.js');
  assert.ok(fs.existsSync(file), '需要独立气泡窗口');
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /focusable:\s*false/);
  assert.match(source, /showInactive/);
  assert.match(source, /setIgnoreMouseEvents/);
});

test('气泡字体固定可读且通过文本节点显示文案', () => {
  const file = path.resolve(__dirname, '../bubble.css');
  assert.ok(fs.existsSync(file), '需要气泡样式');
  assert.match(fs.readFileSync(file, 'utf8'), /font-size:\s*14px/);
  const source = read('bubble-renderer.js');
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /innerHTML/);
});
