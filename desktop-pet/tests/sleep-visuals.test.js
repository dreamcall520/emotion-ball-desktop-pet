const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ballSource = fs.readFileSync(
  path.resolve(__dirname, '../../emotion-ball/js/ball.js'),
  'utf8'
);
const mainSource = fs.readFileSync(
  path.resolve(__dirname, '../main.js'),
  'utf8'
);

test('极小尺寸仍创建并更新睡眠 Zzz 动效', () => {
  assert.match(ballSource, /var zzzNodes = \[\];/);
  assert.match(ballSource, /class: 'eb-sleep-z'/);

  const updateZzzAt = ballSource.indexOf('renderZzz(now, b.zzz || 0);');
  const skipHeavyEffectsAt = ballSource.indexOf('if (lite) return;', updateZzzAt);

  assert.ok(updateZzzAt >= 0, '每帧应该更新 Zzz');
  assert.ok(skipHeavyEffectsAt > updateZzzAt, '轻量模式只能跳过重型特效，不能跳过 Zzz');
});

test('极小尺寸睡眠态保留可辨认的闭眼厚度', () => {
  assert.match(ballSource, /class: 'eb-eye'/);
  assert.match(
    ballSource,
    /var minEyeOpen = lite && \(b\.zzz \|\| 0\) > 0 \? 0\.22 : 0\.02;/
  );
  assert.match(ballSource, /setEye\(eyeL, pose\.left, 0, sketch, yaw, minEyeOpen\)/);
  assert.match(ballSource, /setEye\(eyeR, pose\.right, 1, sketch, yaw, minEyeOpen\)/);
});

test('真实启动检查同时覆盖超小和极小尺寸的睡眼与 Zzz', () => {
  assert.match(mainSource, /setPetSize\('micro'\)/);
  assert.match(mainSource, /setPetSize\('tiny'\)/);
  assert.match(mainSource, /document\.querySelectorAll\('\.eb-sleep-z'\)/);
  assert.match(mainSource, /getBoundingClientRect\(\)\.height/);
  assert.match(mainSource, /PET_SLEEP_VISUAL_OK/);
  assert.match(mainSource, /PET_SLEEP_VISUAL_MICRO_OK/);
});

test('真实启动检查可输出睡眠态截图供视觉验收', () => {
  assert.match(mainSource, /process\.env\.PET_SMOKE_SCREENSHOT/);
  assert.match(mainSource, /webContents\.capturePage\(\)/);
});
